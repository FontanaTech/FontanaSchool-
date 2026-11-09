// Banco del examen general ABCD (versión 1). Cada pregunta sale de un contenido enseñado en la plataforma (ver `source`).
// Una pregunta publicada nunca se edita: un cambio crea otra con un id nuevo y sube FINAL_EXAM_BANK_VERSION.

export const FINAL_EXAM_BANK_VERSION = 1;

export const FINAL_EXAM_TOPICS = {
  conceptos: 'Conceptos básicos de cobranza',
  etapas: 'Etapas y procedimiento de la gestión',
  tipos: 'Tipos de cobranza',
  'titular-datos': 'Identificación del titular y protección de datos',
  comunicacion: 'Comunicación telefónica y servicio',
  objeciones: 'Manejo de objeciones',
  acuerdos: 'Acuerdos y compromisos de pago',
  registro: 'Registro de la gestión',
  tipificacion: 'Tipificación de llamadas',
  'control-next': 'Uso de Control Next',
  ofimatica: 'Ortografía y herramientas de trabajo',
} as const;
export type FinalExamTopic = keyof typeof FINAL_EXAM_TOPICS;

export interface FinalExamQuestion {
  id: string;            // 'v1-<tema>-<nn>', p. ej. 'v1-objeciones-03'
  topic: FinalExamTopic;
  prompt: string;
  options: readonly [string, string, string, string]; // A, B, C, D
  answer: 0 | 1 | 2 | 3;
  explanation: string;   // una frase que se muestra al terminar el examen en las respuestas incorrectas
  source: string;        // archivo(s) del repositorio en que se basa la pregunta
  needsValidation?: true; // solo si se basa en contenido marcado como propuesta o pendiente de validar
}

export const FINAL_EXAM_BANK: readonly FinalExamQuestion[] = [
  // ── Conceptos básicos ───────────────────────────────────────────────────────────────────
  {
    id: 'v1-conceptos-01', topic: 'conceptos',
    prompt: '¿Qué significa que una obligación esté en mora?',
    options: [
      'Que sigue pendiente después de la fecha de pago.',
      'Que tiene una fecha límite para realizar el pago.',
      'Que el cliente ya pagó una parte de la deuda.',
      'Que forma parte de las cuentas que se gestionan.',
    ],
    answer: 0,
    explanation: 'La mora es la deuda que sigue pendiente después de la fecha de pago (el vencimiento).',
    source: 'server/domain/collections.ts',
  },
  {
    id: 'v1-conceptos-02', topic: 'conceptos',
    prompt: 'El cliente dice: «Voy a pagar el viernes». ¿Cómo se interpreta esa frase?',
    options: [
      'Como un pago confirmado, porque lo afirma el titular.',
      'Como una promesa que todavía no demuestra un pago.',
      'Como un abono que se resta del saldo de inmediato.',
      'Como un pago reportado que ya puede darse por cierto.',
    ],
    answer: 1,
    explanation: '«Voy a pagar» es una promesa: expresa lo que la persona hará y no demuestra que haya pagado.',
    source: 'server/domain/collections.ts',
  },
  {
    id: 'v1-conceptos-03', topic: 'conceptos',
    prompt: '¿Qué se necesita para considerar un pago como confirmado?',
    options: [
      'Que el cliente envíe la imagen de un comprobante.',
      'Que el cliente afirme con seguridad que ya pagó.',
      'Verificar su recepción y aplicación en la fuente autorizada.',
      'Que la fecha del compromiso pase sin ninguna novedad.',
    ],
    answer: 2,
    explanation: 'Un pago confirmado exige verificar su recepción y aplicación en la fuente autorizada; un comprobante por sí solo no basta.',
    source: 'server/domain/collections.ts',
  },
  {
    id: 'v1-conceptos-04', topic: 'conceptos',
    prompt: '¿Qué es un abono?',
    options: [
      'El dinero que sigue pendiente por pagar.',
      'La promesa de pagar un monto en una fecha.',
      'El conjunto de cuentas que se gestionan.',
      'El pago de una parte de la deuda.',
    ],
    answer: 3,
    explanation: 'Un abono es un pago parcial: cubre una parte de la deuda, no toda.',
    source: 'server/domain/collections.ts',
  },

  // ── Etapas y procedimiento ──────────────────────────────────────────────────────────────
  {
    id: 'v1-etapas-01', topic: 'etapas',
    prompt: 'Antes de contactar al cliente, ¿qué datos de la ficha debes revisar?',
    options: [
      'Identificación, saldo, vencimiento, historial y compromisos anteriores.',
      'Saldo, descuentos de otras cuentas, ciudad, correo y horario.',
      'Nombre, ingresos, empleo, familiares y referencias del cliente.',
      'Vencimiento, honorarios, tipo de pausa, extensión y asesor.',
    ],
    answer: 0,
    explanation: 'La preparación revisa cinco datos: identificación, saldo, vencimiento, historial y compromisos anteriores, además de la fecha de actualización.',
    source: 'src/collections/lessons.ts, server/domain/collections.ts',
  },
  {
    id: 'v1-etapas-02', topic: 'etapas',
    prompt: 'Al preparar la gestión ves que el saldo no tiene fecha de actualización. ¿Qué haces?',
    options: [
      'Lo uso tal como aparece, porque está en pantalla.',
      'Verifico su vigencia en la fuente autorizada antes de usarlo.',
      'Le resto los abonos que el cliente haya reportado antes.',
      'Le pido al cliente que me confirme cuál es su saldo.',
    ],
    answer: 1,
    explanation: 'Se trabaja con información vigente: ver un dato no demuestra cuándo se actualizó.',
    source: 'server/domain/collections.ts, src/collections/quick-challenge.ts',
  },
  {
    id: 'v1-etapas-03', topic: 'etapas',
    prompt: 'Después de dominar los conceptos, ¿en qué orden avanza la ruta de la gestión?',
    options: [
      'Contacta y escucha, prepara, cierra y registra, explora alternativas.',
      'Explora alternativas, prepara, contacta y escucha, cierra y registra.',
      'Prepara, contacta y escucha, explora alternativas, cierra y registra.',
      'Prepara, explora alternativas, contacta y escucha, cierra y registra.',
    ],
    answer: 2,
    explanation: 'La ruta es: preparar, contactar y escuchar, explorar alternativas y, al final, cerrar y registrar.',
    source: 'src/collections/lessons.ts',
  },
  {
    id: 'v1-etapas-04', topic: 'etapas',
    prompt: 'Según el método de trabajo, ¿en qué etapa te presentas y validas la identidad del cliente?',
    options: [
      'Preparar la gestión.',
      'Escuchar y comprender.',
      'Registrar y dar seguimiento.',
      'Iniciar el contacto.',
    ],
    answer: 3,
    explanation: 'En «Iniciar el contacto» te presentas y validas la identidad antes de comunicar datos de la obligación.',
    source: 'src/content.ts, index.html',
    needsValidation: true,
  },

  // ── Tipos de cobranza ───────────────────────────────────────────────────────────────────
  {
    id: 'v1-tipos-01', topic: 'tipos',
    prompt: '¿Qué tipos de cobranza maneja hoy Fontana?',
    options: [
      'Administrativa, prejurídica, castigada y judicializada.',
      'Administrativa, prejurídica y judicializada, únicamente.',
      'Prejurídica, castigada y judicializada, únicamente.',
      'Administrativa y prejurídica, sin carteras castigadas.',
    ],
    answer: 0,
    explanation: 'Fontana maneja cobranza administrativa, prejurídica, castigada y judicializada.',
    source: 'src/objections/content.ts',
  },
  {
    id: 'v1-tipos-02', topic: 'tipos',
    prompt: '¿Qué caracteriza a la cobranza administrativa?',
    options: [
      'Gestiona una obligación cuya cobranza está en un proceso judicial.',
      'Gestiona obligaciones vencidas por contacto directo, sin proceso judicial.',
      'Gestiona obligaciones que la entidad retiró de su cartera activa.',
      'Gestiona solo por correo, sin hablar directamente con el cliente.',
    ],
    answer: 1,
    explanation: 'La cobranza administrativa gestiona obligaciones ya vencidas mediante contacto directo con el cliente, sin proceso judicial.',
    source: 'src/objections/content.ts',
  },
  {
    id: 'v1-tipos-03', topic: 'tipos',
    prompt: '¿Qué es una obligación castigada?',
    options: [
      'Una obligación que deja de existir al salir de la cartera activa.',
      'Una obligación que se gestiona antes de un proceso judicial.',
      'Una obligación de difícil recaudo, retirada de la cartera activa, que sigue existiendo.',
      'Una obligación cuya cobranza ya se encuentra en un proceso judicial.',
    ],
    answer: 2,
    explanation: 'La entidad la clasificó como de difícil recaudo y la retiró de su cartera activa, pero la obligación continúa existiendo.',
    source: 'src/objections/content.ts',
  },
  {
    id: 'v1-tipos-04', topic: 'tipos',
    prompt: '¿Qué busca la cobranza prejurídica?',
    options: [
      'Fijar plazos nuevos sin consultar los lineamientos.',
      'Anticipar al cliente las decisiones de un juez.',
      'Gestionar una obligación que ya está en un proceso judicial.',
      'Resolver la obligación antes de llegar a un proceso judicial.',
    ],
    answer: 3,
    explanation: 'La prejurídica antecede a un proceso judicial y busca resolver la obligación antes de llegar a esa instancia.',
    source: 'src/objections/content.ts',
  },

  // ── Titular y protección de datos ───────────────────────────────────────────────────────
  {
    id: 'v1-titular-datos-01', topic: 'titular-datos',
    prompt: 'Contesta un familiar y el titular no está disponible. ¿Qué haces?',
    options: [
      'No revelo la deuda, dejo el mensaje para que el titular se comunique.',
      'Le explico el saldo para que se lo comunique al titular.',
      'Le propongo un acuerdo de pago a nombre del titular.',
      'Le pido los datos bancarios del titular para registrarlos.',
    ],
    answer: 0,
    explanation: 'Con un tercero nunca se dan valores ni se negocia: solo se deja el mensaje para que el titular se comunique.',
    source: 'src/simulador/domain/expert/minimum.ts, src/collections/quick-challenge.ts',
  },
  {
    id: 'v1-titular-datos-02', topic: 'titular-datos',
    prompt: 'La identidad de quien contestó no pudo verificarse. ¿Qué corresponde?',
    options: [
      'Informar el saldo para que la persona se identifique.',
      'Mantener la información reservada y seguir la ruta interna.',
      'Continuar con los datos financieros para ganar tiempo.',
      'Pedir a otra persona que confirme quién es el titular.',
    ],
    answer: 1,
    explanation: 'Si la identidad no se verifica, no se revela la obligación y se aplica la ruta interna de verificación fallida.',
    source: 'server/domain/collections.ts',
  },
  {
    id: 'v1-titular-datos-03', topic: 'titular-datos',
    prompt: '¿En qué momento puedes informar el saldo de la obligación?',
    options: [
      'Apenas la persona contesta, para explicar el motivo.',
      'Cuando quien contesta dice ser familiar del titular.',
      'Después de verificar la identidad según el protocolo interno.',
      'Al dejar el mensaje grabado en el buzón de voz del número.',
    ],
    answer: 2,
    explanation: 'La información de la obligación solo se comparte después de verificar la identidad según el protocolo interno.',
    source: 'server/domain/collections.ts, server/domain/collections-exam.ts',
  },
  {
    id: 'v1-titular-datos-04', topic: 'titular-datos',
    prompt: 'El cliente recibió un mensaje externo que le ofrece refinanciar su deuda. ¿Qué le recomiendas?',
    options: [
      'Aceptar la oferta si el mensaje menciona correctamente su deuda.',
      'Enviarte sus datos bancarios para validar la oferta recibida.',
      'Responder el mensaje para pedir más detalles de la oferta.',
      'No compartir datos por mensajes que no pueda verificar y usar canales oficiales.',
    ],
    answer: 3,
    explanation: 'Podría ser un fraude: no se comparten datos personales ni bancarios por canales que no se puedan verificar.',
    source: 'src/objections/content.ts',
  },

  // ── Comunicación telefónica ─────────────────────────────────────────────────────────────
  {
    id: 'v1-comunicacion-01', topic: 'comunicacion',
    prompt: '¿Qué informa el aviso de calidad al inicio de la llamada?',
    options: [
      'Que la llamada está siendo grabada y monitoreada por efectos de calidad.',
      'Que la grabación de la llamada sirve para confirmar los pagos.',
      'Que la grabación de la llamada equivale a aprobar un descuento.',
      'Que la llamada deja de grabarse si el cliente así lo solicita.',
    ],
    answer: 0,
    explanation: 'El aviso informa que la llamada se graba y monitorea por efectos de calidad; no confirma pagos ni aprueba descuentos.',
    source: 'src/collections/guided-case-model.ts, server/domain/collections-exam.ts',
  },
  {
    id: 'v1-comunicacion-02', topic: 'comunicacion',
    prompt: '¿Qué debe incluir tu saludo y presentación, antes de hablar de la deuda?',
    options: [
      'El saludo, el saldo pendiente, los días de mora y el abono.',
      'El saludo, tu nombre, la entidad que representas y la cartera.',
      'Tu nombre, tu extensión, tu cédula y tu correo de contacto.',
      'El saludo, el motivo legal del cobro y el plazo para pagar.',
    ],
    answer: 1,
    explanation: 'La presentación incluye saludo, tu nombre, la entidad que representas y la cartera asignada, además del aviso de calidad.',
    source: 'server/domain/collections-exam.ts, src/collections/guided-case-model.ts',
  },
  {
    id: 'v1-comunicacion-03', topic: 'comunicacion',
    prompt: 'El cliente dice: «Este mes tuve un gasto inesperado». ¿Cuál respuesta muestra escucha activa?',
    options: [
      '«Eso es una excusa; debe pagar como sea.»',
      '«Entonces le garantizo un descuento hoy.»',
      '«Entiendo. ¿Cómo afecta eso su posibilidad de pago?»',
      '«Si no paga hoy, mañana tendrá consecuencias.»',
    ],
    answer: 2,
    explanation: 'Escuchar es reconocer la situación y hacer una pregunta para comprenderla, sin juzgar, presionar ni prometer.',
    source: 'server/domain/collections.ts, src/collections/lessons.ts',
  },
  {
    id: 'v1-comunicacion-04', topic: 'comunicacion',
    prompt: '¿Cuál práctica forma parte de un tono que genera confianza?',
    options: [
      'Interrumpir al cliente para ir directo al saldo.',
      'Usar un tono de reproche ante la demora en el pago.',
      'Responder rápido aunque sea con suposiciones.',
      'Reconocer lo que no puedes confirmar todavía.',
    ],
    answer: 3,
    explanation: 'Un tono que genera confianza es calmado y claro, dice qué vas a revisar y reconoce lo que no puedes confirmar.',
    source: 'src/objections/content.ts',
  },

  // ── Objeciones ──────────────────────────────────────────────────────────────────────────
  {
    id: 'v1-objeciones-01', topic: 'objeciones',
    prompt: '¿Qué es una objeción en una gestión de cobranza?',
    options: [
      'Una duda, dificultad o inconformidad que debes comprender antes de responder.',
      'Un ataque del cliente que conviene responder con firmeza y rapidez.',
      'Una negativa definitiva que permite dar por cerrada la gestión.',
      'Una excusa del cliente que no hace falta registrar en la nota.',
    ],
    answer: 0,
    explanation: 'Una objeción no es un ataque: es una duda, dificultad o inconformidad que se comprende antes de responder.',
    source: 'src/objections/content.ts',
  },
  {
    id: 'v1-objeciones-02', topic: 'objeciones',
    prompt: '¿Cuál es el primer paso de la secuencia para responder una objeción?',
    options: [
      'Confirmar la información en la fuente autorizada.',
      'Escuchar sin interrumpir.',
      'Dar una respuesta clara, dentro de lo permitido.',
      'Confirmar el siguiente paso o compromiso.',
    ],
    answer: 1,
    explanation: 'La secuencia empieza por escuchar sin interrumpir; luego validar, preguntar, confirmar, responder y acordar el siguiente paso.',
    source: 'src/objections/content.ts',
  },
  {
    id: 'v1-objeciones-03', topic: 'objeciones',
    prompt: 'En el manejo de objeciones, ¿qué significa validar la inquietud del cliente?',
    options: [
      'Aceptar lo que el cliente pide para calmar la conversación.',
      'Explicarle que su inquietud no tiene ningún fundamento.',
      'Mostrar que lo escuchaste, sin darle ni quitarle la razón.',
      'Confirmar en el sistema que el cliente tiene la razón.',
    ],
    answer: 2,
    explanation: 'Validar no es dar ni quitar la razón: es reconocer con respeto que escuchaste su inquietud.',
    source: 'src/objections/content.ts',
  },
  {
    id: 'v1-objeciones-04', topic: 'objeciones',
    prompt: 'El cliente dice: «Tengo una reclamación en curso, no voy a pagar mientras tanto». ¿Qué haces?',
    options: [
      'Le aseguro que el reclamo se resolverá a su favor.',
      'Le prometo suspender la gestión hasta que lo resuelvan.',
      'Le digo que el reclamo no cambia nada y que debe pagar.',
      'Verifico si la reclamación figura registrada y sigo el procedimiento.',
    ],
    answer: 3,
    explanation: 'Se verifica si la reclamación está registrada y su estado, sin asegurar el resultado ni prometer suspender la gestión.',
    source: 'src/objections/content.ts',
  },

  // ── Acuerdos de pago ────────────────────────────────────────────────────────────────────
  {
    id: 'v1-acuerdos-01', topic: 'acuerdos',
    prompt: 'El saldo es $400.000 y el cliente dice: «Puedo cancelar los $400.000 completos hoy». ¿Qué alternativa encaja?',
    options: [
      'Pago total.',
      'Abono + fechas.',
      'Fecha Acuerdo Pago total.',
      'Descuento con el líder.',
    ],
    answer: 0,
    explanation: 'Puede cubrir toda la deuda hoy: es un pago total, que se confirma solo después de verificarlo.',
    source: 'src/collections/guided-case-model.ts, server/domain/collections-exam.ts',
  },
  {
    id: 'v1-acuerdos-02', topic: 'acuerdos',
    prompt: 'El cliente dice: «Puedo abonar $100.000 y acordar fechas para los $300.000 restantes». ¿Qué alternativa encaja?',
    options: [
      'Pago total.',
      'Abono + fechas.',
      'Descuento con el líder.',
      'Fecha Acuerdo Pago total.',
    ],
    answer: 1,
    explanation: 'Propone pagar una parte ahora y fechas para el resto: corresponde Abono + fechas, según las condiciones autorizadas.',
    source: 'src/collections/guided-case-model.ts, server/domain/collections-exam.ts',
  },
  {
    id: 'v1-acuerdos-03', topic: 'acuerdos',
    prompt: 'El cliente pide un descuento que no está aprobado para su cuenta. ¿Qué le respondes?',
    options: [
      '«Le apruebo un descuento para que pague hoy mismo.»',
      '«Seguro el líder lo acepta, así que pague tranquilo.»',
      '«Voy a validarlo con mi líder; por ahora no está aprobado.»',
      '«Pague primero y yo le garantizo el descuento después.»',
    ],
    answer: 2,
    explanation: 'Un descuento se valida con el líder antes de ofrecerlo; consultar no equivale a aprobar ni a prometer el resultado.',
    source: 'server/domain/collections-exam.ts, src/collections/lessons.ts',
  },
  {
    id: 'v1-acuerdos-04', topic: 'acuerdos',
    prompt: 'Al cerrar la llamada con un compromiso de pago, ¿qué debes confirmar con el cliente?',
    options: [
      'Solo la fecha, porque el monto ya aparece en la ficha.',
      'El saldo total, aunque lo acordado haya sido un abono.',
      'Solo que el cliente tiene voluntad de pagar su deuda.',
      'El monto, la fecha y el alcance del compromiso.',
    ],
    answer: 3,
    explanation: 'Al cerrar se repasa con la persona el monto, la fecha y el alcance del compromiso antes de despedirse.',
    source: 'server/domain/collections.ts, src/collections/lessons.ts',
  },

  // ── Registro de la gestión ──────────────────────────────────────────────────────────────
  {
    id: 'v1-registro-01', topic: 'registro',
    prompt: '¿Qué partes debe tener una nota de gestión clara?',
    options: [
      'Resultado, compromiso, pendiente y próxima acción.',
      'Saludo, saldo, objeción del cliente y despedida.',
      'Resultado, opinión del asesor, saldo y fecha.',
      'Teléfono, ciudad, correo y asesor asignado.',
    ],
    answer: 0,
    explanation: 'La nota registra resultado, compromiso, pendiente y próxima acción, con hechos y sin juicios.',
    source: 'src/collections/lessons.ts, server/domain/collections.ts',
  },
  {
    id: 'v1-registro-02', topic: 'registro',
    prompt: '¿Cómo se corrige la nota «La cliente pagó $200.000 porque prometió hacerlo el día 20»?',
    options: [
      'Pago confirmado de $200.000, pendiente de que la cliente lo realice.',
      'Compromiso de abono de $200.000 para el 20/11/2026; sin pago confirmado.',
      'Se contactó a la cliente; no hay novedades para registrar en la nota.',
      'La cliente pagó $200.000 y queda pendiente solo el saldo restante.',
    ],
    answer: 1,
    explanation: 'Una promesa se registra como compromiso, con monto y fecha, dejando claro que no hay pago confirmado.',
    source: 'server/domain/collections.ts',
  },
  {
    id: 'v1-registro-03', topic: 'registro',
    prompt: '¿Cómo empieza habitualmente la gestión escrita en Control Next?',
    options: [
      'Con la fecha y la hora exactas de la llamada.',
      'Con el nombre del asesor y su extensión.',
      'Con el teléfono: «3001234567 // TT INDICA QUE…».',
      'Con el saldo total y los días de mora del cliente.',
    ],
    answer: 2,
    explanation: 'El formato habitual empieza con el teléfono seguido de «//» y de quién contestó, por ejemplo «TT INDICA QUE…».',
    source: 'src/simulador/data/guide-steps.ts, src/simulador/domain/expert/minimum.ts',
  },
  {
    id: 'v1-registro-04', topic: 'registro',
    prompt: 'Si la llamada la contestó un tercero, ¿qué debe decir la gestión escrita sobre quién contestó?',
    options: [
      'Solo «TT», porque la cuenta pertenece al titular.',
      'Nada, porque basta con tipificar el tipo de contacto.',
      'El valor de la deuda que se le explicó al tercero.',
      'Que contestó un tercero y su parentesco con el titular.',
    ],
    answer: 3,
    explanation: 'La gestión dice quién contestó: «TT» si fue el titular, o el tercero y su parentesco, por ejemplo «contesta la hermana».',
    source: 'src/simulador/domain/expert/minimum.ts',
  },

  // ── Tipificación ────────────────────────────────────────────────────────────────────────
  {
    id: 'v1-tipificacion-01', topic: 'tipificacion',
    prompt: 'El cliente te llamó a ti. ¿Qué acción eliges al tipificar?',
    options: [
      'Recibir Llamada.',
      'Hacer Llamada.',
      'Remarcar.',
      'Buzón.',
    ],
    answer: 0,
    explanation: '«Hacer Llamada» se usa si tú marcaste; «Recibir Llamada», si el cliente te llamó.',
    source: 'src/simulador/domain/expert/minimum.ts, src/simulador/domain/typification/catalog.ts',
  },
  {
    id: 'v1-tipificacion-02', topic: 'tipificacion',
    prompt: 'Si la acción es «Recibir Llamada», ¿qué opciones de Contacto aparecen?',
    options: [
      'Directo, Indirecto y Sin Contacto.',
      'Directo e Indirecto.',
      'Solo Contacto Directo.',
      'Indirecto y Sin Contacto.',
    ],
    answer: 1,
    explanation: 'Si el cliente llama siempre hay alguien al otro lado: «Sin Contacto» solo existe cuando tú haces la llamada.',
    source: 'src/simulador/domain/typification/catalog.ts, src/simulador/data/guide-steps.ts',
  },
  {
    id: 'v1-tipificacion-03', topic: 'tipificacion',
    prompt: 'El titular, con saldo de $360.000, se compromete a pagar $180.000 en una fecha concreta. ¿Qué perfil corresponde?',
    options: [
      'Acuerdo de pago Total.',
      'Paz y Salvo.',
      'Acuerdo de pago Abono.',
      'Volver a llamar.',
    ],
    answer: 2,
    explanation: 'Paga solo una parte del saldo en una fecha pactada: es un acuerdo de pago Abono, con fecha y valor.',
    source: 'src/simulador/domain/expert/exercises.ts, src/simulador/domain/typification/catalog.ts',
  },
  {
    id: 'v1-tipificacion-04', topic: 'tipificacion',
    prompt: 'El titular asegura que ya pagó y tiene el comprobante, pero el pago aún no aparece aplicado. ¿Cómo tipificas?',
    options: [
      'Paz y Salvo, porque tiene el comprobante.',
      'ABONANDO, con motivo «Confirmar pago».',
      'Incumplido, con motivo «Olvido pago».',
      'PQR, con motivo «Con recibo».',
    ],
    answer: 3,
    explanation: 'Queda como solicitud de verificación (PQR) con motivo «Con recibo»; no se marca Paz y Salvo hasta confirmar el pago.',
    source: 'src/simulador/domain/expert/exercises.ts',
  },

  // ── Control Next ────────────────────────────────────────────────────────────────────────
  {
    id: 'v1-control-next-01', topic: 'control-next',
    prompt: '¿Qué opciones del menú lateral de Control Next usamos en la operación?',
    options: [
      'Main, Dashboard, Productividad y Clientes.',
      'Main, Adm. Pausas, Dashboard y Clientes.',
      'Dashboard, Adm. Pausas, Productividad y Main.',
      'Clientes, Archivos, Adm. Pausas y Dashboard.',
    ],
    answer: 0,
    explanation: 'Solo usamos Main, Dashboard, Productividad y Clientes; «Adm. Pausas» no es de nuestro uso.',
    source: 'src/simulador/data/guide-steps.ts, src/tipifica/tipifica.ts',
  },
  {
    id: 'v1-control-next-02', topic: 'control-next',
    prompt: 'Un cliente te devuelve la llamada. ¿Cuál es la forma más rápida de abrir su ficha?',
    options: [
      'Recorrer la tabla de clientes hasta encontrarlo.',
      'Usar la lupa, abrir «Buscar» y escribir su cédula.',
      'Filtrar la lista por ciudad y por último perfil.',
      'Abrir la pestaña «Archivos» y revisar la asignación.',
    ],
    answer: 1,
    explanation: 'La lupa abre el panel «Buscar»: escribes la cédula, confirmas campaña, nombre e identificación y abres la ficha.',
    source: 'src/simulador/data/guide-steps.ts, src/tipifica/tipifica.ts',
  },
  {
    id: 'v1-control-next-03', topic: 'control-next',
    prompt: 'Vas a levantarte del puesto para almorzar y estás en una llamada. ¿Qué haces?',
    options: [
      'Dejo la sesión abierta y le aviso a un compañero.',
      'Entro a «Adm. Pausas» en el menú lateral y salgo.',
      'Cuelgo y guardo; luego avatar, «Pausa», elijo el tipo y «Enviar».',
      'Pulso «Logout» y vuelvo a ingresar cuando regrese.',
    ],
    answer: 2,
    explanation: 'Primero terminas la llamada y guardas; luego avatar › Pausa › tipo › Enviar. Al volver pulsas «Continuar».',
    source: 'src/simulador/data/guide-steps.ts',
  },
  {
    id: 'v1-control-next-04', topic: 'control-next',
    prompt: 'En el semáforo de gestión de cartera, ¿qué indica el color rojo?',
    options: [
      'Que el cliente fue gestionado hoy.',
      'Que el cliente no tiene ninguna gestión.',
      'Que lleva menos de 5 días sin gestión.',
      'Que lleva más de 5 días sin gestión.',
    ],
    answer: 3,
    explanation: 'Cian es sin gestión, amarillo menos de 5 días, rojo más de 5 días y verde gestionado hoy.',
    source: 'src/simulador/data/guide-steps.ts',
  },

  // ── Ofimática ───────────────────────────────────────────────────────────────────────────
  {
    id: 'v1-ofimatica-01', topic: 'ofimatica',
    prompt: '¿Cuál frase está escrita correctamente?',
    options: [
      'El cliente ha pagado. Ya está hecho el registro.',
      'El cliente a pagado. Ya está hecho el registro.',
      'El cliente ha pagado. Ya esta echo el registro.',
      'El cliente a pagado. Ya está echo el registro.',
    ],
    answer: 0,
    explanation: '«Ha» es del verbo haber (se cambia por «había») y «hecho» viene de hacer; «echo» es de echar.',
    source: 'server/domain/office-content.ts',
  },
  {
    id: 'v1-ofimatica-02', topic: 'ofimatica',
    prompt: '¿Cuál frase está escrita correctamente?',
    options: [
      'Ahí un acuerdo de pago vigente. El soporte está hay.',
      'Hay un acuerdo de pago vigente. El soporte está ahí.',
      'Hay un acuerdo de pago vigente. El soporte está hay.',
      'Ay un acuerdo de pago vigente. El soporte está ahí.',
    ],
    answer: 1,
    explanation: '«Hay» equivale a «existe»; «ahí» señala un lugar; «ay» es una exclamación.',
    source: 'server/domain/office-content.ts',
  },
  {
    id: 'v1-ofimatica-03', topic: 'ofimatica',
    prompt: 'En Excel, ¿qué fórmula suma los valores de las celdas B2 a B6?',
    options: [
      '=SUMA(B2-B6)',
      'SUMA(B2:B6)',
      '=SUMA(B2:B6)',
      '=SUMA(B2 B6)',
    ],
    answer: 2,
    explanation: 'Toda fórmula empieza con «=» y los dos puntos indican el rango: =SUMA(B2:B6).',
    source: 'server/domain/office-content.ts',
  },
  {
    id: 'v1-ofimatica-04', topic: 'ofimatica',
    prompt: 'En Excel en español, ¿qué atajo deshace el último cambio?',
    options: [
      'Ctrl + Y',
      'Ctrl + X',
      'Ctrl + G',
      'Ctrl + Z',
    ],
    answer: 3,
    explanation: 'Ctrl + Z deshace; Ctrl + Y rehace, Ctrl + X corta y Ctrl + G guarda el libro.',
    source: 'server/domain/office-content.ts',
  },
];
