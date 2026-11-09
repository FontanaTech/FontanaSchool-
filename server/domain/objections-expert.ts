import { optionFor } from './objections-options.js';
// Reglas de formación versionadas. Se evalúa el contenido de la gestión escrita con expresiones equivalentes;
// no se exige copiar un guion. El resultado explica cada regla y conserva la evidencia para revisión humana.
export const OBJECTIONS_EXPERT_VERSION = 1;
// El formato de borradores y la configuración permanecen compatibles. La política
// de calificación se guarda aparte para conservar intactos los resultados anteriores.
export const OBJECTIONS_GRADING_VERSION = 2;
// Versión 3: el asesor elige la opción más óptima entre cuatro (ver objections-options.ts).
export const OBJECTIONS_OPTIONS_VERSION = 3;
export const OBJECTIONS_EXAM_TITLE = 'Objeciones: evaluación escrita de cinco casos';
export const OBJECTIONS_MIN_SCORE = 80;
export const OBJECTIONS_MAX_TEXT = 1500;
export const OBJECTIONS_CASE_KEYS = ['sin-dinero', 'no-reconoce', 'ya-pague', 'contacto-excesivo', 'salario-pendiente'] as const;
export type ObjectionCaseKey = typeof OBJECTIONS_CASE_KEYS[number];

export const OBJECTIONS_CASES = [
  { key: 'sin-dinero', title: 'No tengo dinero', icon: 'wallet', client: 'En este momento no tengo dinero. No puedo pagar lo que me están pidiendo.',
    situation: 'La identidad ya fue verificada. Pista: pregunta qué alternativa o apoyo voluntario podría ayudarle a reunir el dinero y en qué fecha. No hay descuentos autorizados.',
    explain: 'Escucha su situación y explora posibilidades reales. Puedes invitarle a consultar apoyo voluntario de terceros u otras alternativas que le faciliten reunir el dinero.',
    actions: ['Reconoce su situación sin juzgar.', 'Pregunta por su capacidad, un posible apoyo de terceros y una fecha viable.', 'Revisa las alternativas con la persona y registra solo lo que confirme.'],
    avoid: 'Responder «si no tiene dinero, no hay nada que hacer», presionar por un pago inmediato o cerrar la conversación sin explorar alternativas. Así puedes perder la oportunidad de llegar a un acuerdo.',
    example: 'Comprendo que no dispone de recursos ahora. ¿Podría consultar un apoyo voluntario de un tercero u otra alternativa para reunir el dinero? ¿Qué posibilidad y fecha serían viables? Revisemos las opciones. Registro la situación para seguimiento, sin compromiso confirmado.' },
  { key: 'no-reconoce', title: 'No reconozco esa deuda', icon: 'search', client: 'No reconozco esa deuda. No sé de dónde salió esa obligación.',
    situation: 'La identidad ya fue verificada, pero la deuda aún no está aclarada. Pista: escucha su duda y propón revisar el origen y los soportes antes de hablar de pago.',
    explain: 'Una duda sobre la obligación necesita verificación. Revisa los soportes y orienta la validación por el canal interno correspondiente.',
    actions: ['Reconoce la duda del titular.', 'Verifica el origen y los soportes de la obligación.', 'Registra el desconocimiento y deriva la solicitud para revisión.'],
    avoid: 'Discutir, decir «usted sí debe» sin revisar o exigir el pago antes de aclarar su duda. Esto rompe la confianza y dificulta continuar la negociación.',
    example: 'Entiendo su inquietud porque desconoce la obligación. Voy a verificar el origen y los soportes. Registro la solicitud y la remito al área responsable para su revisión y seguimiento.' },
  { key: 'ya-pague', title: 'Ya pagué', icon: 'receipt', client: 'Yo ya pagué. Hice el pago y todavía me están cobrando.',
    situation: 'La identidad ya fue verificada y el pago aún no aparece confirmado. Pista: pregunta cuándo y cuánto pagó, solicita el comprobante y explica que revisarás su aplicación.',
    explain: 'Un pago reportado requiere validación. Pide los datos necesarios y orienta el envío del soporte por un canal autorizado.',
    actions: ['Escucha el reporte de pago.', 'Solicita fecha, valor y comprobante por el canal autorizado.', 'Deja el pago pendiente de validación y registra el seguimiento.'],
    avoid: 'Desconfiar de entrada, decir «si no aparece, no ha pagado» o seguir exigiendo dinero sin revisar el soporte. Puedes convertir una aclaración en un conflicto.',
    example: 'Gracias por informar que ya realizó el pago. ¿En qué fecha y por qué valor? Solicito el comprobante por el canal autorizado. Registro el reporte como pendiente de validación y dejo seguimiento para verificar su aplicación.' },
  { key: 'contacto-excesivo', title: 'Estoy harto/a de los mensajes y llamadas', icon: 'phone', client: 'Constantemente recibo mensajes y llamadas. Estoy harto de que me contacten tanto.',
    situation: 'La identidad ya fue verificada. Pista: reconoce su molestia, pregunta qué canal y horario prefiere y propón revisar los contactos según el protocolo interno.',
    explain: 'Primero atiende la inconformidad. Pregunta por la preferencia de contacto y tramita su revisión con el área responsable.',
    actions: ['Reconoce la molestia y mantén la calma.', 'Pregunta qué canal y horario prefiere.', 'Registra la queja y solicita revisar los contactos según el protocolo.'],
    avoid: 'Responder a la defensiva, minimizar su molestia o insistir en el pago sin escuchar la queja. Esto aumenta el rechazo y puede cerrar el diálogo.',
    example: 'Lamento la molestia por las llamadas y los mensajes. ¿Qué canal y horario prefiere para el contacto? Registro su inconformidad y solicito al área responsable revisar la frecuencia según el protocolo interno. Dejo seguimiento de la solicitud.' },
  { key: 'salario-pendiente', title: 'Aún no me han pagado en el trabajo', icon: 'calendar', client: 'Todavía no me han pagado en el trabajo. Estoy esperando que me consignen el sueldo.',
    situation: 'La identidad ya fue verificada; aún no hay fecha ni compromiso confirmado. Pista: pregunta cuándo espera recibir su sueldo y acuerda un seguimiento, sin dar el pago por hecho.',
    explain: 'Un ingreso pendiente no es una fecha de pago confirmada. Pregunta cuándo espera recibirlo y qué podría asumir, sin dar por hecho un acuerdo.',
    actions: ['Reconoce que el ingreso está pendiente.', 'Pregunta por la fecha estimada y la posibilidad real de pago.', 'Registra la información como estimada y acuerda un seguimiento.'],
    avoid: 'Decir «eso no es mi problema», exigir una fecha que no puede cumplir o terminar la llamada sin explorar cuándo podría pagar. Así se pierde la oportunidad de acordar un seguimiento viable.',
    example: 'Comprendo que su salario está pendiente. ¿Cuándo estima recibir la nómina y qué posibilidad de pago tendría entonces? Registro la fecha como estimada, sin compromiso confirmado, y acordamos un seguimiento para revisar las opciones autorizadas.' },
] as const;

type Rule = { id: string; label: string; advice: string; patterns: RegExp[]; all?: boolean };
const rule = (id: string, label: string, advice: string, ...patterns: RegExp[]): Rule => ({ id, label, advice, patterns });
const empathy = rule('escucha', 'Trato respetuoso y escucha', 'Reconoce la situación del cliente con respeto antes de proponer una acción.', /entiend|comprend|lamento|gracias|respeto|reconozco|se escucha|se atiende|se reconoce|escuch[aeo]/);
const record = rule('registro', 'Registro y seguimiento fiel a lo informado', 'Explica qué registrarías y cuál sería el siguiente paso, sin inventar acuerdos.', /registr|dejo (?:constancia|nota)|se document|anot/, /seguimiento|volver.{0,15}contact|pendiente|remit|revis|confirm|acord/);
record.all = true;
const RULES: Record<ObjectionCaseKey, Rule[]> = {
  'sin-dinero': [empathy,
    rule('situacion', 'Reconoce la falta de recursos', 'Distingue la falta actual de dinero de una negativa a pagar.', /(?:no|sin|falta).{0,25}(?:dinero|recursos|capacidad|ingresos)|situacion (?:economica|financiera)/),
    rule('consulta', 'Pregunta por una posibilidad real', 'Pregunta qué posibilidad, monto o fecha puede asumir la persona.', /(?:pregunt|consult|que|cual|cuanto|cuando).{0,55}(?:posibilidad|capacidad|viable|fecha|monto|podria|puede)/),
    rule('alternativa', 'Explora alternativas de apoyo', 'Puedes consultar por un apoyo voluntario de terceros u otras opciones para reunir el dinero, sin imponer préstamos.', /(?:revis|consult|explor|evalu|verific).{0,65}(?:alternativ|opcion|condicion|apoyo|tercero)/), record],
  'no-reconoce': [empathy,
    rule('situacion', 'Identifica el desconocimiento de la deuda', 'Registra que el titular desconoce o tiene dudas sobre la obligación.', /desconoc|no reconoc|duda.{0,25}(?:deuda|obligacion)|inquietud.{0,25}(?:deuda|obligacion)/),
    rule('consulta', 'Verifica el origen y los soportes', 'Revisa el origen o los soportes de la obligación antes de afirmar algo.', /(?:verific|revis|valid|consult).{0,55}(?:origen|soport|document|obligacion)/),
    rule('alternativa', 'Orienta una revisión del caso', 'Deriva la solicitud al área o canal responsable para aclarar la obligación.', /(?:remit|deriv|escal|solicit|orient|envi).{0,65}(?:area|canal|revision|aclar|validacion|soport)/), record],
  'ya-pague': [empathy,
    rule('situacion', 'Distingue un pago reportado', 'Reconoce que la persona reporta un pago, todavía sin confirmación.', /(?:report|inform|indic|realiz|efectu).{0,30}pag|ya pag|pago reportado/),
    { ...rule('consulta', 'Solicita datos y soporte del pago', 'Pide fecha y valor, junto con el comprobante o soporte para validar el pago.', /fecha/, /valor|monto/, /comprobante|soporte|recibo/), all: true },
    rule('alternativa', 'Deja el pago pendiente de validación', 'Explica que se verificará el pago antes de confirmarlo o aplicarlo.', /pendiente.{0,25}(?:valid|verific|confirm)|(?:verific|valid).{0,35}(?:aplic|pag)|(?:antes de|hasta).{0,30}confirm/), record],
  'contacto-excesivo': [empathy,
    rule('situacion', 'Reconoce la inconformidad por el contacto', 'Reconoce la molestia por la frecuencia de mensajes o llamadas.', /molesti|inconform|queja|hastio|exceso|frecuen/),
    { ...rule('consulta', 'Consulta la preferencia de contacto', 'Pregunta por el canal y horario que prefiere la persona.', /canal|medio/, /horario|hora|franja/, /prefier|preferencia|pregunt|consult|cual|que/), all: true },
    rule('alternativa', 'Tramita la revisión según el protocolo', 'Solicita revisar los contactos o deriva la queja según el protocolo interno.', /(?:revis|remit|escal|solicit|deriv).{0,80}(?:contact|frecuen|queja|area|protocolo)/), record],
  'salario-pendiente': [empathy,
    rule('situacion', 'Reconoce el ingreso pendiente', 'Identifica que la nómina o el salario todavía están pendientes.', /(?:salario|nomina|sueldo|ingreso).{0,30}(?:pendiente|esper|no|estim)|(?:no|sin|esper).{0,30}(?:salario|nomina|sueldo|ingreso)/),
    rule('consulta', 'Pregunta por la fecha estimada del ingreso', 'Pregunta cuándo estima recibir el ingreso; no lo registres como confirmado.', /(?:cuando|fecha|dia).{0,55}(?:estim|recib|pagu|nomina|ingreso)|estima.{0,35}(?:nomina|ingreso|fecha)/),
    rule('alternativa', 'Explora capacidad sin inventar un compromiso', 'Pregunta por una posibilidad real de pago sin asumir que existe un compromiso.', /(?:posibilidad|capacidad|podria|puede).{0,35}(?:pag|asum|abonar)|sin.{0,25}compromiso confirmado/), record],
};

export type ObjectionCheck = { id: string; label: string; ok: boolean; points: number; evidence: string | null; feedback: string };
export type ObjectionCaseGrade = { key: ObjectionCaseKey; title: string; answer: string; score: number; maximum: 20; checks: ObjectionCheck[]; critical: string[]; recommendations: string[] };
export type ObjectionsGrade = { version: number; score: number; minimumScore: number; passed: boolean; cases: ObjectionCaseGrade[]; criticalCount: number; recommendations: string[] };
export type ObjectionsPayload = { version: number; attemptId: string; answers: Record<string, string>; result?: ObjectionsGrade };
export function readObjectionsPayload(value: unknown): ObjectionsPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as ObjectionsPayload;
  return payload.version === OBJECTIONS_EXPERT_VERSION && typeof payload.attemptId === 'string'
    && Boolean(payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)) ? payload : null;
}

export function normalizeObjection(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\bclte\b/g, 'cliente').replace(/\btt\b/g, 'titular').replace(/\bpte\b/g, 'pendiente').replace(/\s+/g, ' ').trim();
}

// Una expresión negada ("no confirmaré el pago") o condicional no se cuenta como acción ejecutada.
function positiveMatch(text: string, pattern: RegExp): string | null {
  const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
  for (const match of matches) {
    const prefix = text.slice(Math.max(0, match.index! - 55), match.index);
    if (/(?:\bno|nunca|jamas|evit\w*|sin)\s+(?:(?:voy|vamos|debo|debe|se|a|de|que|el|un|una|ha|he|hay)\s+){0,5}$/.test(prefix)) continue;
    return match[0];
  }
  return null;
}

export function objectionRisks(answer: string): string[] {
  const clauses = normalizeObjection(answer).split(/[.!?;\n]+/);
  const risks = [
    { label: 'Amenaza o presión no respaldada por el caso.', pattern: /(?:le|te) (?:voy|vamos) a (?:embargar|demandar)|(?:ira|vas|terminara|terminaras) a la carcel|si no paga.{0,35}(?:embarg|carcel)|pague o.{0,25}(?:embarg|carcel)/ },
    { label: 'Ofrece una modificación sin autorización.', pattern: /(?:le|te) (?:ofrezco|aplico|garantizo|apruebo).{0,30}(?:descuento|condonacion)|(?:elimino|borro).{0,25}(?:deuda|interes)/ },
    { label: 'Da un pago por confirmado sin validación.', pattern: /(?:marco|registro|confirmo|doy).{0,25}(?:pagad|paz y salvo|pago confirmado)|(?:deuda|cuenta|saldo|obligacion) (?:esta|queda|quedo|se encuentra) (?:pagad|saldad|cancelad)/ },
    { label: 'Presiona para obtener préstamos o vender bienes.', pattern: /(?:pida|solicite|saque|consiga).{0,20}(?:prestamo|credito)|(?:venda|empene).{0,20}(?:bienes|casa|cosas)/ },
    { label: 'Promete contactos insistentes o suspenderlos de forma absoluta.', pattern: /seguiremos llamando|llamaremos.{0,25}(?:todos los dias|cada hora)|nunca (?:mas )?(?:volveremos|lo vamos) a (?:llamar|contactar)/ },
  ];
  const found = risks.filter(risk => clauses.some(clause => {
    const conditional = /(?:una vez|despues de|tras|cuando se|si se).{0,25}(?:verific|valid|confirm)/.exec(clause);
    const hit = positiveMatch(clause, risk.pattern);
    if (!hit) return false;
    // Consultar una posibilidad voluntaria no equivale a imponer un préstamo.
    if (risk.label.startsWith('Presiona para')
      && /si (?:lo desea|usted quiere|quiere|le parece|esta de acuerdo)|voluntari\w*|podria\w*|le gustaria|puede considerar/.test(clause.slice(0, clause.indexOf(hit)))
      && !/\bdebe\b|tiene que|obliga|exijo|exigimos/.test(clause)) return false;
    // La condición debe anteceder la acción; no justifica una amenaza escrita antes en la misma frase.
    if (risk.label.startsWith('Da un pago') && conditional && conditional.index < clause.indexOf(hit)) return false;
    if (risk.label.startsWith('Da un pago') && /(?:cliente|titular).{0,10}(?:dice|indica|manifiesta|reporta|informa).{0,15}que/.test(clause.slice(0, clause.indexOf(hit))) && !/(?:confirmo|marco|doy|registro.{0,15}confirmado)/.test(clause)) return false;
    return true;
  })).map(risk => risk.label);
  if (/no dejaremos de llamar|hasta que pague seguiremos/.test(normalizeObjection(answer))) found.push('Insistencia de contacto como presión para pagar.');
  return [...new Set(found)];
}

// Calificación de una opción elegida: 20 la más completa, 10 la aceptable pero incompleta, 0 la inadecuada.
function gradeOption(key: ObjectionCaseKey, title: string, explain: string, id: string): ObjectionCaseGrade {
  const option = optionFor(key, id)!;
  const best = option.score === 20;
  return { key, title, answer: option.text, maximum: 20, score: option.score,
    checks: [{ id: 'respuesta', label: best ? 'Elegiste la respuesta más completa' : option.score === 10 ? 'Tu respuesta es aceptable, pero incompleta' : 'Había una respuesta mejor', ok: best, points: option.score, evidence: null, feedback: option.why }],
    critical: option.risk ? [option.risk] : [],
    recommendations: best ? [] : [`La respuesta más óptima ${explain.charAt(0).toLowerCase()}${explain.slice(1)}`] };
}

export function gradeObjectionCase(key: ObjectionCaseKey, answer: string): ObjectionCaseGrade {
  const entry = OBJECTIONS_CASES.find(c => c.key === key);
  if (!entry) throw new Error('Caso no reconocido.');
  if (typeof answer === 'string' && optionFor(key, answer.trim())) return gradeOption(key, entry.title, entry.explain, answer.trim());
  if (typeof answer !== 'string' || !answer.trim() || answer.length > OBJECTIONS_MAX_TEXT) throw new Error(`Escribe una respuesta para este caso, de hasta ${OBJECTIONS_MAX_TEXT} caracteres.`);
  const text = normalizeObjection(answer);
  const related = CASE_TOPICS[key].test(text);
  const action = positiveMatch(text, /pregunt\w*|consult\w*|revis\w*|verific\w*|valid\w*|solicit\w*|pid[oa]\w*|pedir\w*|pedi\w*|envi\w*|mand\w*|regal\w*|busc\w*|brind\w*|doy|damos|dar|compart\w*|adjunt\w*|remit\w*|deriv\w*|escal\w*|orient\w*|ayud\w*|ofrec\w*|ofrez\w*|propon\w*|propu\w*|propo[ns]\w*|acord\w*|acuerd\w*|agend\w*|program\w*|registr\w*|anot\w*|document\w*|confirm\w*|indiqu\w*|indica\w*|cuent\w*|escuch\w*|atend\w*|esper\w*|podemos|podria\w*|podemo\w*|puede\w*|prefier\w*|prefer\w*|cuando|cuanto|cual|que (?:dia|fecha|monto|valor|canal|hora)/);
  const ok = related && Boolean(action) && (text.match(/[a-z]+/g)?.length ?? 0) >= 2;
  // Los antiguos criterios solo orientan: no son requisitos ni restan puntos.
  const suggestions = RULES[key].filter(rule => {
    const evidence = rule.patterns.map(p => positiveMatch(text, p));
    return !(rule.all ? evidence.every(Boolean) : evidence.some(Boolean));
  }).map(rule => rule.advice);
  return { key, title: entry.title, answer, maximum: 20, score: ok ? 20 : 0,
    checks: [{ id: 'respuesta', label: ok ? 'Respuesta aprobada' : 'Dale un enfoque al caso', ok, points: ok ? 20 : 0,
      evidence: null, feedback: ok ? 'Tu respuesta propone una gestión relacionada con esta situación. No necesitas seguir un guion.' : `Explica con tus palabras qué harías ante «${entry.title}». Por ejemplo: ${entry.actions[1]}` }],
    critical: [], recommendations: ok
      ? [...objectionRisks(answer).map(r => `Recomendación de mejora: ${r}`), ...suggestions].slice(0, 2)
      : [`Explica una acción concreta relacionada con el caso. ${entry.actions[1]}`] };
}

// Vocabulario amplio: se acepta lenguaje cotidiano, preguntas y notas de gestión.
// No se exige mencionar todos los aspectos ni copiar las frases de la lección.
const CASE_TOPICS: Record<ObjectionCaseKey, RegExp> = {
  'sin-dinero': /dinero|recurso|ingreso|econom|financier|situacion|pag[oaue]|pagar|abono|cuota|plazo|fecha|monto|posibilidad|opcion|alternativa|acuerdo|apoyo|tercero|familiar|amigo/,
  'no-reconoce': /deuda|obligacion|credito|origen|soporte|document|desconoc|reconoc|aclar|caso|informacion|dato|sistema|contrato/,
  'ya-pague': /pag[oaue]|pagar|comprobante|soporte|recibo|transferencia|consignacion|movimiento|sistema/,
  'contacto-excesivo': /llamad|mensaje|contact|molest|inconform|queja|frecuen|horario|hora|canal|medio|whatsapp|correo|celular|telefono/,
  'salario-pendiente': /salario|nomina|sueldo|ingreso|trabajo|quincena|pag[oaue]|pagar|consign|fecha|dia|plazo|posibilidad/,
};

export function gradeObjections(answers: Record<string, string>, minimumScore = OBJECTIONS_MIN_SCORE): ObjectionsGrade {
  if (Object.keys(answers).length !== 5 || OBJECTIONS_CASE_KEYS.some(k => typeof answers[k] !== 'string')) throw new Error('Completa los cinco casos antes de enviar la evaluación.');
  const cases = OBJECTIONS_CASE_KEYS.map(key => gradeObjectionCase(key, answers[key]!));
  const score = cases.reduce((sum, c) => sum + c.score, 0);
  const criticalCount = cases.reduce((sum, c) => sum + c.critical.length, 0);
  const byOptions = OBJECTIONS_CASE_KEYS.every(key => Boolean(optionFor(key, answers[key]!.trim())));
  return { version: byOptions ? OBJECTIONS_OPTIONS_VERSION : OBJECTIONS_GRADING_VERSION, score, minimumScore, passed: score >= minimumScore,
    cases, criticalCount, recommendations: cases.flatMap(c => c.recommendations.map(r => `${c.title}: ${r}`)) };
}
