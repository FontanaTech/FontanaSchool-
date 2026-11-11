// Contenido inicial (ficticio) del módulo "Ofimática para tus cobranzas".
// Sin nombres, cédulas, teléfonos, correos ni empresas reales.

export type SeedTypingText = { key: string; title: string; content: string };

// Entre 650 y 900 caracteres cada uno. Atención al cliente y cobranzas.
export const TYPING_TEXTS: SeedTypingText[] = [
  {
    key: 'primer-contacto',
    title: 'Primer contacto con el cliente',
    content: 'Buenas tardes, le habla un asesor del equipo de cobranzas. Me comunico para recordarle que su obligación presenta un saldo pendiente. Antes de continuar necesito confirmar que hablo con la persona titular de la cuenta. Si usted lo desea, puedo explicarle el valor actual, la fecha de vencimiento y las alternativas de pago disponibles. Nuestro objetivo es ayudarle a encontrar una solución que se ajuste a su presupuesto y que le permita ponerse al día sin contratiempos. Escuchamos con atención cada situación y registramos los acuerdos con claridad para que usted cuente con un soporte. Gracias por su tiempo y por permitirnos orientarle en este proceso con respeto y transparencia.',
  },
  {
    key: 'acuerdo-de-pago',
    title: 'Confirmación de un acuerdo de pago',
    content: 'Le confirmo que su acuerdo de pago quedó registrado en el sistema. El primer abono será el próximo viernes y el saldo restante se dividirá en dos cuotas iguales. Es importante que conserve el comprobante de cada pago, porque con ese documento podemos actualizar su estado de manera inmediata. Si por alguna razón no puede cumplir con la fecha acordada, le pedimos que se comunique con nosotros antes del vencimiento para revisar otra opción. Un acuerdo cumplido le permite mantener un buen historial y evitar nuevos cobros. Quedamos atentos a su pago y le agradecemos la disposición que ha mostrado durante toda la conversación. Cualquier novedad que surja la registraremos de inmediato para mantenerle informado.',
  },
  {
    key: 'cliente-molesto',
    title: 'Atención a un cliente molesto',
    content: 'Entiendo su molestia y le agradezco que me explique con calma lo ocurrido. Mi intención es escucharle y buscar una respuesta clara. Voy a revisar el historial de la cuenta para verificar la información que usted menciona y, si encuentro una diferencia, la dejaré documentada para que el área encargada la analice. Mientras tanto, le pido que me indique el valor que considera correcto y la fecha del pago que realizó. Con esos datos podré orientarle de forma precisa. Quiero que sepa que su caso es importante y que el trato respetuoso es parte de nuestro compromiso. Le daré una respuesta antes de terminar nuestra llamada. Gracias por su paciencia y por darnos la oportunidad de ayudarle.',
  },
  {
    key: 'soporte-de-pago',
    title: 'Solicitud de soporte de pago',
    content: 'Para actualizar su cuenta necesito el soporte del pago que usted realizó. Puede enviarlo por correo electrónico o por mensaje, siempre que se vea con claridad la fecha, el valor y el número de referencia. Una vez lo recibamos, el área de conciliación lo revisará y el estado de la obligación se actualizará en un plazo de uno a tres días hábiles. Si pasado ese tiempo la cuenta no refleja el pago, comuníquese de nuevo y con gusto haremos el seguimiento correspondiente. Le recomiendo guardar el soporte original hasta que el saldo aparezca en cero, porque es la mejor garantía para cualquier aclaración posterior que pueda presentarse. Gracias por su colaboración y por enviarnos la información completa.',
  },
  {
    key: 'devolver-llamada',
    title: 'Devolución de llamada programada',
    content: 'Entiendo que en este momento no puede atender la llamada. Para no interrumpirle, programaré un nuevo contacto en el horario que usted prefiera. Dígame, por favor, qué día y a qué hora le resulta más cómodo recibirla. Dejaré la observación registrada para que cualquier compañero del equipo conozca el acuerdo y no tenga que repetirle las preguntas. Recuerde que mantener al día la información de contacto nos permite comunicarnos solamente cuando sea necesario. Le agradezco su amabilidad y quedo atento a la fecha que me indique. Que tenga una excelente jornada y gracias por habernos permitido continuar con este proceso en otro momento. Hasta pronto, y que tenga una feliz tarde.',
  },
  {
    key: 'cierre-de-gestion',
    title: 'Cierre de la gestión',
    content: 'Antes de terminar quiero resumir lo que hemos acordado. Usted realizará el pago el día convenido, enviará el soporte por correo y nosotros actualizaremos el estado de la obligación. Si surge cualquier inconveniente, puede comunicarse con nosotros en horario de atención y mencionar el número de su caso. Tomaré nota de esta conversación para que quede toda la información disponible y pueda consultarse con facilidad. Agradezco el tiempo que me dedicó y la actitud con la que atendió la llamada. Un cierre claro evita confusiones y deja tranquilidad a ambas partes. Le deseo un buen día y quedo a su disposición para cualquier duda adicional que pueda tener sobre su cuenta.',
  },
];

export const PRACTICE_NOTE = 'Los textos de práctica viven en server/domain/office.ts.';

// ---------------------------------------------------------------------------------------------
// Excel: escenario con reservas ficticias; cada intento se genera con una semilla propia.
// ---------------------------------------------------------------------------------------------

export const EXCEL_SCENARIO_DATA = {
  version: 1,
  baseDate: '2026-11-02',
  pools: {
    nombres: [
      'Laura Ejemplo', 'Mateo Muestra', 'Sofía Ejemplo', 'Julián Muestra', 'Valentina Ejemplo', 'Andrés Muestra', 'Camila Ejemplo', 'Daniel Muestra',
      'Isabela Ejemplo', 'Samuel Muestra', 'Mariana Ejemplo', 'Tomás Muestra', 'Daniela Ejemplo', 'Felipe Muestra', 'Gabriela Ejemplo', 'Nicolás Muestra',
      'Paula Ejemplo', 'Emilio Muestra', 'Renata Ejemplo', 'Simón Muestra',
    ],
    empresas: ['Comercial Alfa Demo S.A.S.', 'Servicios Beta Demo S.A.S.', 'Textiles Gama Demo S.A.S.', 'Distribuciones Delta Demo S.A.S.'],
    ciudades: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga'],
    motivos: ['Confirmar pago', 'Enviar soporte', 'Revisar acuerdo', 'Actualizar datos', 'Validar fecha de pago'],
    asesores: ['Asesor Demo 1', 'Asesor Demo 2', 'Asesor Demo 3'],
    estadosAcuerdo: ['Pendiente', 'Cumplido', 'Incumplido'],
    estadosPago: ['Pagado', 'Parcial', 'Pendiente'],
  },
  rows: { busquedas: 10, volver: 8, acuerdos: 8, pagos: 10 },
} as const;

// Pesos de los pasos (suman 100). questionId = <lección>.<paso>.
export const EXCEL_ANSWER_KEY = {
  version: 1,
  steps: [
    { id: 'busquedas.filtro', lesson: 'busquedas', kind: 'filter', weight: 10, hint: 'Filtra la columna Empresa por la empresa que indica la instrucción.' },
    { id: 'busquedas.localizar', lesson: 'busquedas', kind: 'select', weight: 10, hint: 'Selecciona al cliente que pide la instrucción, con su cédula, dentro de la empresa filtrada.' },
    { id: 'volver.registrar', lesson: 'volver', kind: 'append-callback', weight: 12, hint: 'Agrega la devolución de llamada con el cliente, la fecha y la hora que indica la instrucción.' },
    { id: 'volver.ordenar', lesson: 'volver', kind: 'sorted', weight: 12, hint: 'Ordena la columna Fecha de seguimiento de la más próxima a la más lejana.' },
    { id: 'acuerdos.completar', lesson: 'acuerdos', kind: 'agreement', weight: 14, hint: 'Completa el valor, el estado y la fecha del acuerdo exactamente como lo pide el caso.' },
    { id: 'pagos.faltante', lesson: 'pagos', kind: 'formula-difference', weight: 14, hint: 'El faltante es la meta menos el recaudo: escribe una fórmula como =H2-I2.' },
    { id: 'pagos.total', lesson: 'pagos', kind: 'formula-sum', weight: 14, hint: 'El total de saldos se calcula con =SUMA(C2:C500).' },
    { id: 'pagos.moneda', lesson: 'pagos', kind: 'format', weight: 14, hint: 'Aplica el formato Moneda COP a la columna de saldos.' },
  ],
} as const;

// ---------------------------------------------------------------------------------------------
// Ortografía: catálogo de reglas del sistema experto y ejercicios de dictado (en borrador).
// ---------------------------------------------------------------------------------------------

export type SeedRule = {
  key: string;
  category: 'HOMOFONA' | 'TILDE_DIACRITICA' | 'FORMA_VERBAL' | 'PUNTUACION' | 'MAYUSCULA';
  severity: 'CRITICAL' | 'MINOR';
  weight: number;
  pairs: [string, string][];
  explanation: string;
  examples: { incorrect: string; correct: string }[];
};

export const SPELLING_RULES: SeedRule[] = [
  { key: 'homofona-a-ver-haber', category: 'HOMOFONA', severity: 'CRITICAL', weight: 15, pairs: [['a ver', 'haber']],
    explanation: '«A ver» sirve para mirar o comprobar algo; «haber» es el verbo (debe haber, haber pagado).',
    examples: [{ incorrect: 'Debe a ver un error en el saldo.', correct: 'Debe haber un error en el saldo.' }] },
  { key: 'homofona-hay-ahi-ay', category: 'HOMOFONA', severity: 'CRITICAL', weight: 15, pairs: [['hay', 'ahí'], ['hay', 'ay'], ['ahí', 'ay']],
    explanation: '«Hay» es del verbo haber (existe), «ahí» indica un lugar y «ay» es una exclamación.',
    examples: [{ incorrect: 'Ahí un acuerdo vigente.', correct: 'Hay un acuerdo vigente.' }] },
  { key: 'homofona-porque', category: 'HOMOFONA', severity: 'CRITICAL', weight: 15,
    pairs: [['porque', 'por qué'], ['porque', 'por que'], ['por qué', 'por que'], ['porqué', 'por qué'], ['porqué', 'porque']],
    explanation: '«Porque» da la causa, «por qué» pregunta y «el porqué» es el motivo.',
    examples: [{ incorrect: 'No pagó por que perdió el empleo.', correct: 'No pagó porque perdió el empleo.' }] },
  { key: 'homofona-sino-si-no', category: 'HOMOFONA', severity: 'CRITICAL', weight: 15, pairs: [['sino', 'si no']],
    explanation: '«Sino» contrapone después de una negación; «si no» expresa una condición.',
    examples: [{ incorrect: 'No pagó el lunes si no el martes.', correct: 'No pagó el lunes sino el martes.' }] },
  { key: 'homofona-ha-a', category: 'HOMOFONA', severity: 'CRITICAL', weight: 15, pairs: [['ha', 'a']],
    explanation: '«Ha» es del verbo haber (ha pagado); «a» es una preposición (va a pagar).',
    examples: [{ incorrect: 'El cliente a pagado.', correct: 'El cliente ha pagado.' }] },
  { key: 'homofona-hecho-echo', category: 'HOMOFONA', severity: 'CRITICAL', weight: 15, pairs: [['hecho', 'echo'], ['hecha', 'echa']],
    explanation: '«Hecho» viene de hacer; «echo» viene de echar.',
    examples: [{ incorrect: 'El registro ya está echo.', correct: 'El registro ya está hecho.' }] },
  { key: 'tilde-tu', category: 'TILDE_DIACRITICA', severity: 'MINOR', weight: 3, pairs: [['tú', 'tu']],
    explanation: '«Tú» es el pronombre; «tu» indica posesión.', examples: [{ incorrect: 'Tu debes confirmar.', correct: 'Tú debes confirmar.' }] },
  { key: 'tilde-el', category: 'TILDE_DIACRITICA', severity: 'MINOR', weight: 3, pairs: [['él', 'el']],
    explanation: '«Él» es el pronombre; «el» es el artículo.', examples: [{ incorrect: 'El confirmó el pago.', correct: 'Él confirmó el pago.' }] },
  { key: 'tilde-si', category: 'TILDE_DIACRITICA', severity: 'MINOR', weight: 3, pairs: [['sí', 'si']],
    explanation: '«Sí» afirma; «si» es condicional.', examples: [{ incorrect: 'Dijo que si puede pagar.', correct: 'Dijo que sí puede pagar.' }] },
  { key: 'tilde-mi', category: 'TILDE_DIACRITICA', severity: 'MINOR', weight: 3, pairs: [['mí', 'mi']],
    explanation: '«Mí» es el pronombre; «mi» indica posesión.', examples: [{ incorrect: 'Para mi es claro.', correct: 'Para mí es claro.' }] },
  { key: 'verbal-dijiste', category: 'FORMA_VERBAL', severity: 'CRITICAL', weight: 15, pairs: [['dijiste', 'dijistes']],
    explanation: 'La segunda persona del pretérito no lleva «s» final: «dijiste».', examples: [{ incorrect: 'Dijistes que pagabas.', correct: 'Dijiste que pagabas.' }] },
  { key: 'verbal-fuiste', category: 'FORMA_VERBAL', severity: 'CRITICAL', weight: 15, pairs: [['fuiste', 'fuistes']],
    explanation: 'La segunda persona del pretérito no lleva «s» final: «fuiste».', examples: [{ incorrect: 'Fuistes claro.', correct: 'Fuiste claro.' }] },
  { key: 'verbal-haya', category: 'FORMA_VERBAL', severity: 'CRITICAL', weight: 15, pairs: [['haya', 'haiga']],
    explanation: '«Haiga» no existe: la forma correcta es «haya».', examples: [{ incorrect: 'Es posible que haiga un error.', correct: 'Es posible que haya un error.' }] },
  { key: 'verbal-hubo', category: 'FORMA_VERBAL', severity: 'CRITICAL', weight: 15, pairs: [['hubo', 'hubieron']],
    explanation: '«Haber» impersonal va en singular: «hubo muchas personas».', examples: [{ incorrect: 'Hubieron muchas personas.', correct: 'Hubo muchas personas.' }] },
  { key: 'puntuacion-general', category: 'PUNTUACION', severity: 'MINOR', weight: 2, pairs: [],
    explanation: 'Las comas y los puntos separan las ideas y hacen más clara la observación.', examples: [{ incorrect: 'El cliente confirmó el pago quedó para el lunes', correct: 'El cliente confirmó el pago. Quedó para el lunes.' }] },
  { key: 'mayuscula-inicial', category: 'MAYUSCULA', severity: 'MINOR', weight: 1, pairs: [],
    explanation: 'Se escribe con mayúscula al comenzar una oración y después de un punto.', examples: [{ incorrect: 'el cliente confirmó el pago.', correct: 'El cliente confirmó el pago.' }] },
];

export type SeedDictation = { key: string; title: string; expectedText: string; difficulty: number; criticalRuleKeys: string[] };

// Textos de 55 a 80 palabras aproximadamente (20 a 30 segundos de audio).
export const DICTATIONS: SeedDictation[] = [
  {
    key: 'dictado-error-saldo', title: 'Observación: posible error en el saldo', difficulty: 1,
    expectedText: 'El cliente dice que debe haber un error en el saldo porque ya realizó el pago. Quedó pendiente enviar el soporte por correo. Si no llega el lunes, se pasará el caso al supervisor. Hay que confirmar la fecha del acuerdo. Se dejó la observación registrada para que el equipo la revise mañana temprano.',
    criticalRuleKeys: ['homofona-a-ver-haber', 'homofona-porque', 'homofona-hay-ahi-ay'],
  },
  // Siguen activos en la base de producción con su audio en storage/: si se quitan de aquí, el seed los pasa a borrador
  // y, si además se borra el audio, el dictado falla con «Este ejercicio todavía no tiene audio autorizado».
  {
    key: 'dictado-soporte-pago', title: 'Observación: soporte del pago', difficulty: 2,
    expectedText: 'Ahí está el soporte del pago que hizo el cliente. No pagó el martes sino el miércoles, por eso quedó en mora. Él confirmó que sí puede pagar el resto el viernes. Tú debes registrar la observación hoy. El cliente agradeció la llamada y pidió que le enviemos un resumen del acuerdo por mensaje.',
    criticalRuleKeys: ['homofona-hay-ahi-ay', 'homofona-sino-si-no', 'tilde-el', 'tilde-si', 'tilde-tu'],
  },
  {
    key: 'dictado-seguimiento', title: 'Observación: seguimiento de la llamada', difficulty: 3,
    expectedText: 'Dijiste que el cliente fue claro: hubo muchas personas en la llamada. A ver si hoy llega el soporte. Es posible que haya un error en el registro, pero ya está hecho. ¿Por qué no contestó? Se volverá a llamar mañana. El cliente prometió enviar el comprobante antes de las cinco de la tarde.',
    criticalRuleKeys: ['verbal-dijiste', 'verbal-hubo', 'homofona-a-ver-haber', 'verbal-haya', 'homofona-hecho-echo', 'homofona-porque'],
  },
];
