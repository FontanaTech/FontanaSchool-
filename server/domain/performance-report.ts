// Sistema experto de recomendación para el administrador: convierte lo que el asesor hizo en el examen final,
// en Tipifica y en los módulos en oportunidades de mejora priorizadas (qué falló, por qué importa y qué repasar).
// Es una función pura: no toca la base de datos y solo usa lo que el servidor ya calificó y guardó.

export type Severity = 'alta' | 'media' | 'baja';
export type Opportunity = { area: string; severity: Severity; finding: string; recommendation: string; module: string; evidence?: string };

export type FinalExamFinding = { score: number; minimumScore: number; passed: boolean; topics: { label: string; correct: number; total: number; percent: number; module: string }[] };
export type TipificaFinding = { number: number; title: string; met: number; unmet: number; failed: { id: string; label: string; detail: string }[] };
export type ObjectionsFinding = { score: number; minimumScore: number; cases: { title: string; score: number; maximum: number; critical: string[]; recommendations: string[] }[] };
export type ModuleFinding = { name: string; status: string; percent: number };
export type ReportInput = { finalExam: FinalExamFinding | null; tipifica: TipificaFinding[]; objections: ObjectionsFinding | null; modules: ModuleFinding[] };

const RANK: Record<Severity, number> = { alta: 0, media: 1, baja: 2 };

// Qué hacer cuando falla cada punto de la tipificación (las reglas están en server/domain/tipifica/engine.ts).
const TIPIFICA_TIPS: Record<string, string> = {
  accion: 'Practicar quién origina la llamada: «Hacer Llamada» si la hace el asesor y «Recibir Llamada» si entra al asesor.',
  contacto: 'Repasar quién contestó: titular, tercero o sin contacto, según lo que se escucha en el audio.',
  canal: 'Confirmar el canal real de la gestión (telefónico, WhatsApp, etc.) antes de guardar.',
  perfil: 'Repasar cómo se elige el perfil según el desenlace de la llamada (acuerdo, volver a llamar, no contesta…).',
  motivo: 'Practicar el motivo de no pago: debe coincidir con lo que dijo el cliente, no con lo que se supone.',
  telefono: 'Registrar el teléfono exacto al que se llamó o desde el que se recibió la llamada.',
  'nota-telefono': 'En la gestión escrita incluir el teléfono contactado.',
  'nota-valor': 'En la gestión escrita anotar el valor acordado exactamente como lo dijo el cliente.',
  'nota-fecha': 'En la gestión escrita anotar la fecha del compromiso con día y mes.',
  'nota-hora': 'En la gestión escrita anotar la hora acordada cuando el cliente la indica.',
  'nota-detalle': 'Escribir una gestión con suficiente detalle: quién contestó, qué dijo, qué se acordó y el siguiente paso.',
  'tercero-sin-deuda': 'No revelar información de la deuda a terceros: registrar solo el mensaje dejado y quién lo recibió.',
  'acuerdo-campos': 'Completar los campos del acuerdo (fecha y valor) en el formulario, además de la nota.',
  agenda: 'Programar la nueva llamada con la fecha y la hora que pidió el cliente.',
};
const TIPIFICA_MODULE = 'Tipifica (clon de Control Next)';

export function buildOpportunities(input: ReportInput): Opportunity[] {
  const out: Opportunity[] = [];

  const exam = input.finalExam;
  if (exam) {
    if (!exam.passed) {
      out.push({ area: 'Examen final', severity: 'alta', finding: `No alcanzó el mínimo del examen general: ${exam.score} % (mínimo ${exam.minimumScore} %).`, recommendation: 'Reforzar los temas con menor porcentaje antes de la reactivación o del siguiente intento.', module: 'Examen general' });
    }
    for (const topic of exam.topics.filter((item) => item.percent < 70)) {
      out.push({
        area: 'Examen final', severity: topic.percent < 40 ? 'alta' : 'media',
        finding: `Tema «${topic.label}»: ${topic.correct} de ${topic.total} correctas (${topic.percent} %).`,
        recommendation: `Repasar este tema en «${topic.module}» y reforzarlo con un caso práctico.`, module: topic.module,
      });
    }
  }

  // Un mismo punto fallado en varios ejercicios es una falencia recurrente: pesa más que uno aislado.
  const byCheck = new Map<string, { label: string; exercises: number[]; detail: string }>();
  for (const exercise of input.tipifica) {
    for (const check of exercise.failed) {
      const row = byCheck.get(check.id) ?? { label: check.label, exercises: [], detail: check.detail };
      row.exercises.push(exercise.number);
      byCheck.set(check.id, row);
    }
  }
  for (const [id, row] of byCheck) {
    out.push({
      area: 'Tipifica', severity: row.exercises.length > 1 ? 'alta' : 'media',
      finding: `«${row.label}» no coincidió con la llamada en ${row.exercises.length > 1 ? `los ejercicios ${row.exercises.join(' y ')}` : `el ejercicio ${row.exercises[0]}`}.`,
      recommendation: TIPIFICA_TIPS[id] ?? 'Volver a escuchar la llamada y comparar cada campo con lo que realmente se dijo.',
      module: TIPIFICA_MODULE, evidence: row.detail || undefined,
    });
  }

  const objections = input.objections;
  if (objections) {
    for (const item of objections.cases) {
      const ratio = item.maximum ? item.score / item.maximum : 1;
      if (ratio >= 0.7 && !item.critical.length) continue;
      out.push({
        area: 'Manejo de objeciones', severity: item.critical.length || ratio < 0.5 ? 'alta' : 'media',
        finding: `Caso «${item.title}»: ${item.score} de ${item.maximum} puntos${item.critical.length ? ` y errores críticos (${item.critical.join('; ')})` : ''}.`,
        recommendation: item.recommendations[0] ?? 'Repasar las pautas de respuesta a objeciones y volver a practicar el caso.', module: 'Enfréntate a la objeción',
      });
    }
  }

  for (const module of input.modules) {
    if (module.status === 'FAILED') {
      out.push({ area: 'Ruta de formación', severity: 'alta', finding: `Se quedó sin intentos o no aprobó «${module.name}».`, recommendation: 'Analizar con el asesor qué falló y, si corresponde, reactivar el intento desde su expediente.', module: module.name });
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

// Resumen de una línea para el encabezado del informe.
export function summarize(opportunities: Opportunity[]): string {
  if (!opportunities.length) return 'Sin oportunidades de mejora relevantes con los resultados disponibles.';
  const high = opportunities.filter((item) => item.severity === 'alta').length;
  return `${opportunities.length} oportunidad${opportunities.length === 1 ? '' : 'es'} de mejora${high ? `, ${high} de prioridad alta` : ''}.`;
}
