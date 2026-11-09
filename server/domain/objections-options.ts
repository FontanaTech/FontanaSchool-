// Módulo 03 «Enfréntate a la objeción»: en vez de escribir la gestión a mano, el asesor elige entre cuatro respuestas la
// más óptima para cada caso. Este archivo es SOLO del servidor: guarda cuál opción es la mejor y por qué, y nunca viaja
// al navegador (el cliente solo recibe `publicOptions`, sin puntaje ni explicación).
//
// Puntaje por caso (de 20): la opción más completa vale 20; una aceptable pero incompleta, 10; una inadecuada, 0.
// Las opciones marcadas con `risk` además registran una acción de riesgo para la revisión del administrador.
// BORRADOR: el contenido sigue las pautas del módulo; conviene que el líder de cobranzas lo valide antes de usarlo oficialmente.

export type ObjectionOption = { id: 'a' | 'b' | 'c' | 'd'; text: string; score: 20 | 10 | 0; why: string; risk?: string };

export const OBJECTION_OPTIONS: Record<string, readonly ObjectionOption[]> = {
  'sin-dinero': [
    { id: 'a', text: 'Si no tiene dinero no puedo hacer nada. Llámenos cuando tenga con qué pagar.', score: 0,
      why: 'Cierra la conversación sin explorar alternativas: se pierde la oportunidad de llegar a un acuerdo.' },
    { id: 'b', text: 'Entiendo. ¿Cuándo cree que podrá pagar? Déjeme su número y lo llamamos más adelante.', score: 10,
      why: 'Pregunta por la fecha, pero no explora una alternativa real ni registra lo que el cliente confirma.' },
    { id: 'c', text: 'Comprendo su situación. ¿Podría contar con un apoyo voluntario de un familiar u otra alternativa para reunir el dinero? ¿Qué valor y en qué fecha podría pagar? Revisemos las opciones y registro solo lo que me confirme.', score: 20,
      why: 'Reconoce la situación, explora alternativas voluntarias, pregunta por valor y fecha y registra solo lo confirmado.' },
    { id: 'd', text: 'Tiene que conseguir el dinero hoy: pida un préstamo, y si no paga esto seguirá creciendo y tendrá problemas.', score: 0,
      why: 'Presiona para obtener un préstamo y amenaza con consecuencias no respaldadas por el caso.', risk: 'Presiona para obtener préstamos o amenaza sin respaldo.' },
  ],
  'no-reconoce': [
    { id: 'a', text: 'Entiendo su inquietud. Voy a verificar el origen y los soportes de la obligación y le explico lo que encuentre. Registro su desconocimiento y remito la solicitud al área responsable para su revisión.', score: 20,
      why: 'Reconoce la duda, verifica origen y soportes antes de hablar de pago y deriva la solicitud para su revisión.' },
    { id: 'b', text: 'Usted sí debe esa plata, aparece en nuestro sistema, así que tiene que pagarla.', score: 0,
      why: 'Discute y exige el pago sin revisar los soportes: rompe la confianza y dificulta continuar la negociación.' },
    { id: 'c', text: 'Comprendo su duda. Le sugiero escribir a la empresa para que le aclaren el origen; por mi parte no puedo ayudarle con eso.', score: 10,
      why: 'Es respetuosa, pero deja la verificación al cliente en lugar de revisar los soportes y derivar el caso.' },
    { id: 'd', text: 'Aunque no la reconozca, si no paga hoy lo vamos a reportar y a embargar sus bienes.', score: 0,
      why: 'Amenaza con acciones no autorizadas y no atiende la duda sobre la obligación.', risk: 'Amenaza o presión no respaldada por el caso.' },
  ],
  'ya-pague': [
    { id: 'a', text: 'Si no aparece en el sistema, entonces no ha pagado. Tendrá que pagar de nuevo.', score: 0,
      why: 'Desconfía de entrada y exige dinero sin revisar el soporte: convierte una aclaración en un conflicto.' },
    { id: 'b', text: 'Perfecto, entonces registro la deuda como pagada y queda a paz y salvo.', score: 0,
      why: 'Da el pago por confirmado sin validar el soporte.', risk: 'Da un pago por confirmado sin validación.' },
    { id: 'c', text: 'Gracias por informarlo. Envíe el comprobante y mientras tanto le recuerdo que la deuda sigue vigente hasta verla reflejada.', score: 10,
      why: 'Pide el comprobante, pero no solicita fecha y valor ni deja el seguimiento registrado.' },
    { id: 'd', text: 'Gracias por avisarme que ya pagó. ¿En qué fecha y por qué valor lo hizo? Solicito el comprobante por el canal autorizado, dejo el pago pendiente de validación y registro el seguimiento para verificar su aplicación.', score: 20,
      why: 'Pide fecha, valor y comprobante, deja el pago pendiente de validación y registra el seguimiento.' },
  ],
  'contacto-excesivo': [
    { id: 'a', text: 'Es nuestro trabajo llamarle y vamos a seguir haciéndolo hasta que pague.', score: 0,
      why: 'Responde a la defensiva y usa la insistencia como presión: aumenta el rechazo.', risk: 'Insistencia de contacto como presión para pagar.' },
    { id: 'b', text: 'Lamento la molestia por las llamadas y los mensajes. ¿Qué canal y horario prefiere para contactarlo? Registro su inconformidad y solicito revisar la frecuencia de contacto según el protocolo interno.', score: 20,
      why: 'Reconoce la molestia, pregunta por canal y horario y tramita la revisión según el protocolo.' },
    { id: 'c', text: 'Tiene razón, no volverán a llamarle nunca más.', score: 0,
      why: 'Promete suspender el contacto de forma absoluta, algo que el asesor no puede garantizar.', risk: 'Promete suspender contactos de forma absoluta.' },
    { id: 'd', text: 'Lamento la molestia. Voy a pedir que le contacten menos, pero necesito que me diga hoy cuándo va a pagar.', score: 10,
      why: 'Reconoce la molestia, pero la mezcla con presión de pago y no pregunta por canal ni horario.' },
  ],
  'salario-pendiente': [
    { id: 'a', text: 'Eso no es mi problema, usted debe pagar en la fecha acordada.', score: 0,
      why: 'Ignora su situación y exige una fecha que quizá no pueda cumplir.' },
    { id: 'b', text: 'Entonces anoto que pagará el viernes, comprometido y sin falta.', score: 0,
      why: 'Registra como confirmado un compromiso que el cliente no ha dado.', risk: 'Registra un compromiso de pago no confirmado.' },
    { id: 'c', text: 'Comprendo que su salario está pendiente. ¿Cuándo estima recibirlo y qué posibilidad de pago tendría entonces? Registro la fecha como estimada, sin compromiso confirmado, y acordamos un seguimiento.', score: 20,
      why: 'Reconoce el ingreso pendiente, pregunta fecha y capacidad real y deja un seguimiento sin inventar un compromiso.' },
    { id: 'd', text: 'Entiendo. ¿Me confirma qué día le consignan para llamarle ese día?', score: 10,
      why: 'Pregunta por la fecha, pero no explora su capacidad real de pago ni registra el seguimiento.' },
  ],
};

export function optionFor(key: string, id: string): ObjectionOption | undefined {
  return OBJECTION_OPTIONS[key]?.find((option) => option.id === id);
}

// Lo único que ve el asesor: letra y texto de cada opción.
export function publicOptions(key: string): { id: string; text: string }[] {
  return (OBJECTION_OPTIONS[key] ?? []).map(({ id, text }) => ({ id, text }));
}
