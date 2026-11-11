export const PORTFOLIO = 'MARKETING PERSONAL';
export const AGENCY = 'CONSULTORIAS JURIDICAS';
export const QUALITY_NOTICE = 'Antes de continuar, le informo que esta llamada está siendo grabada y monitoreada por efectos de calidad.';
export const CLIENT_REPLY = 'Hoy no puedo confirmar una fecha ni un monto de pago. Necesito revisar mis ingresos. ¿Pueden bajar el saldo?';
export const PAYMENT_QUESTION = '¿Qué posibilidad de pago tiene en este momento?';
export type PaymentAlternative = 'total' | 'abono' | 'descuento' | 'fecha-total';
export const PAYMENT_ALTERNATIVES: { key: PaymentAlternative; title: string; explanation: string; reminder: string }[] = [
  { key: 'total', title: 'Pago total', explanation: 'Pagar el saldo completo de la deuda.', reminder: 'Ejemplo: saldo de $400.000 → pago por $400.000.' },
  { key: 'abono', title: 'Abono + fechas', explanation: 'Abonar una parte y acordar fechas para terminar de cancelar.', reminder: 'Define el abono y las fechas del saldo restante según las condiciones autorizadas.' },
  { key: 'descuento', title: 'Descuento con el líder', explanation: 'Validar el descuento con tu líder antes de ofrecerlo para motivar el pago.', reminder: 'Comunica solo el descuento y las condiciones que el líder autorice.' },
  { key: 'fecha-total', title: 'Fecha Acuerdo Pago total', explanation: 'Acordar una fecha para pagar el saldo completo de la deuda.', reminder: 'Ejemplo ficticio: $400.000 para el 20 de noviembre de 2026. Es un compromiso, no un pago confirmado.' },
];
export const ALTERNATIVE_PRACTICE: { quote: string; expected: PaymentAlternative; feedback: Record<PaymentAlternative, string> }[] = [
  { quote: 'Puedo cancelar los $400.000 completos hoy.', expected: 'total', feedback: {
    total: '', abono: 'Puede cubrir toda la deuda: corresponde un pago total, sin dividir el saldo.', descuento: 'No solicita una rebaja y puede pagar todo. Identifica la opción de pago total.',
    'fecha-total': 'Puede cancelar todo hoy. Elige Pago total; no está proponiendo una fecha futura.',
  } },
  { quote: 'Puedo abonar $100.000 y acordar fechas para cancelar los $300.000 restantes.', expected: 'abono', feedback: {
    total: 'Propone pagar solo una parte ahora. Corresponde un abono y acordar fechas para el saldo restante.', abono: '', descuento: 'No pide reducir la deuda. Propone un abono y fechas para terminar de cancelar.',
    'fecha-total': 'Propone un pago parcial y fechas para el resto, no pagar todo en una sola fecha. Elige Abono + fechas.',
  } },
  { quote: 'Si me autorizan un descuento, podría pagar. ¿Puede revisarlo?', expected: 'descuento', feedback: {
    total: 'El pago depende de una rebaja que aún no está aprobada. Valida el descuento con tu líder.', abono: 'No propone un abono ni fechas. Solicita un descuento: debes validarlo con tu líder.', descuento: '',
    'fecha-total': 'Todavía no acuerda una fecha para pagar todo. Pide un descuento que debes validar con tu líder.',
  } },
  { quote: 'Puedo pagar el saldo total de $400.000 el 20 de noviembre de 2026.', expected: 'fecha-total', feedback: {
    total: 'Propone pagar todo en una fecha futura. Elige Fecha Acuerdo Pago total y registra el compromiso; aún no hay pago confirmado.',
    abono: 'No propone un pago parcial: acuerda pagar todo en una fecha. Elige Fecha Acuerdo Pago total.',
    descuento: 'No solicita descuento. Propone una fecha para pagar el saldo completo.',
    'fecha-total': '',
  } },
];

export const GUIDED_BLOCKS = {
  preparacion: {
    steps: [
      { key: 'saldo', title: 'Verificar el saldo', short: 'Revisa la ficha y su actualización.' },
    ],
    doneTitle: '¡Saldo verificado!', doneText: 'Revisaste la actualización del caso. Continúa con el contacto y la escucha.', nextLabel: 'Continuar al bloque 03 · Contacto y escucha →',
  },
  contacto: {
    intro: 'Saluda, preséntate, informa el protocolo de calidad y escucha a la titular.',
    steps: [
      { key: 'saludo', title: 'Saludar a la titular', short: 'Pregunta por la persona correcta.' },
      { key: 'presentacion', title: 'Presentarte por la cartera', short: 'Di tu nombre y a quién representas.' },
      { key: 'calidad', title: 'Informar el protocolo de calidad', short: 'Grabación y monitoreo por calidad.' },
      { key: 'escucha', title: 'Informar el saldo y escuchar', short: 'Cartera, saldo y pregunta.' },
    ],
    doneTitle: '¡Contacto realizado!', doneText: 'Informaste a la titular y dejaste una pregunta para comprender su situación.', nextLabel: 'Continuar al bloque 04 · Alternativas →',
  },
  alternativas: {
    intro: 'Conoce cuatro posibilidades: Pago total, Abono + fechas, Descuento con el líder y Fecha Acuerdo Pago total.',
    steps: [
      { key: 'posibilidad', title: 'Conocer las cuatro posibilidades', short: 'Pago total, abono, descuento o fecha para pagar todo.' },
    ],
    doneTitle: '¡Posibilidades identificadas!', doneText: 'Practicaste Pago total, Abono + fechas, Descuento con el líder y Fecha Acuerdo Pago total.', nextLabel: 'Continuar al bloque 05 · Cierre y seguimiento →',
  },
  seguimiento: {
    intro: 'Practica seis situaciones de Camila. Acierta la tipificación para abrir el siguiente caso.',
    steps: [
      { key: 'registro', title: 'Tipifica la situación', short: 'Elige el resultado de la gestión.' },
      { key: 'registro', title: 'Tipifica la situación', short: 'Elige el resultado de la gestión.' },
      { key: 'registro', title: 'Tipifica la situación', short: 'Elige el resultado de la gestión.' },
      { key: 'registro', title: 'Tipifica la situación', short: 'Elige el resultado de la gestión.' },
      { key: 'registro', title: 'Tipifica la situación', short: 'Elige el resultado de la gestión.' },
      { key: 'registro', title: 'Tipifica la situación', short: 'Elige el resultado de la gestión.' },
    ],
    doneTitle: '¡Seis casos completados!', doneText: 'Identificaste correctamente el resultado de cada gestión.', nextLabel: 'Ver resultado y sello →',
  },
} as const;
export type GuidedBlockKey = keyof typeof GUIDED_BLOCKS;
export type GuidedStepKey = typeof GUIDED_BLOCKS[GuidedBlockKey]['steps'][number]['key'];
type Choice = { value: string; text: string; feedback: string };
export const QUALITY_ANSWERS: Choice[] = [
  { value: 'pago', text: 'Para confirmar que ya hizo un pago.', feedback: 'La grabación y el monitoreo no confirman un pago. El aviso explica que se realizan por efectos de calidad.' },
  { value: 'calidad', text: 'Para cuidar la calidad de la atención.', feedback: '' },
  { value: 'descuento', text: 'Para aprobarle un descuento.', feedback: 'La grabación y el monitoreo no aprueban descuentos. Su finalidad en el aviso es la calidad.' },
];
export const INFORMATION_QUESTIONS: Choice[] = [
  { value: 'descuento', text: 'Le apruebo un descuento si paga ahora.', feedback: 'No prometas un descuento sin autorización. Después de informar el saldo, pregunta por su posibilidad de pago.' },
  { value: 'posibilidad', text: PAYMENT_QUESTION, feedback: '' },
  { value: 'imponer', text: 'Tiene que pagar todo hoy, sin falta.', feedback: 'No impongas un pago sin escuchar. Pregunta qué posibilidad tiene la titular.' },
];
// Tipificaciones del ejercicio, alineadas con las opciones de contacto directo de Control Next.
export const REGISTRATION_RESULTS = [
  { value: 'paz-salvo', text: 'Paz y Salvo' },
  { value: 'acuerdo-total', text: 'Acuerdo de pago Total' },
  { value: 'acuerdo-abono', text: 'Acuerdo de pago Abono' },
  { value: 'recordar', text: 'Recordar' },
  { value: 'volver-llamar', text: 'Volver a llamar' },
  { value: 'incumplido', text: 'Incumplido' },
  { value: 'sin-acuerdo', text: 'No hubo acuerdo' },
] as const;
export type RegistrationOutcome = typeof REGISTRATION_RESULTS[number]['value'];
export const REGISTRATION_PRACTICE: { expected: RegistrationOutcome; situation: string; feedback: string; note: string }[] = [
  {
    expected: 'paz-salvo',
    situation: 'Camila confirma que pagó los $400.000 completos. Verificas el pago en la fuente autorizada y el saldo queda en cero.',
    feedback: 'El pago total está confirmado y no queda saldo pendiente. La gestión corresponde a Paz y Salvo.',
    note: 'Pago total confirmado en la fuente autorizada. Registrar Paz y Salvo.',
  },
  {
    expected: 'acuerdo-total',
    situation: 'Camila confirma que pagará los $400.000 completos el 20 de noviembre de 2026.',
    feedback: 'Acordó pagar el saldo completo en una fecha futura. Corresponde Acuerdo de pago Total.',
    note: 'Compromiso de pago por el saldo completo con fecha definida. Registrar Acuerdo de pago Total.',
  },
  {
    expected: 'acuerdo-abono',
    situation: 'Camila acuerda abonar $100.000 y cancelar los $300.000 restantes en las fechas definidas.',
    feedback: 'El compromiso es parcial y tiene fechas para completar el saldo. Corresponde Acuerdo de pago Abono.',
    note: 'Abono acordado y saldo restante con fechas definidas. Registrar Acuerdo de pago Abono.',
  },
  {
    expected: 'volver-llamar',
    situation: 'Camila contesta, pero está en una reunión y solicita que la llames nuevamente mañana a las 10:00 a. m.',
    feedback: 'La titular pidió expresamente una nueva llamada con fecha y hora. Corresponde Volver a llamar.',
    note: 'Solicitud expresa de devolución de llamada con fecha y hora definidas.',
  },
  {
    expected: 'incumplido',
    situation: 'Camila había acordado pagar el 20 de noviembre, pero la fecha pasó y no se registra el pago en la fuente autorizada.',
    feedback: 'Existía un compromiso que no se cumplió y el pago no está confirmado. Corresponde Incumplido.',
    note: 'Compromiso vencido sin pago confirmado. Registrar Incumplido y gestionar según el procedimiento.',
  },
  {
    expected: 'sin-acuerdo',
    situation: 'Hablaste con Camila sobre su saldo de $400.000. No acepta ninguna alternativa y la conversación termina sin acuerdo.',
    feedback: 'Hablaste con la titular, pero no aceptó una alternativa ni expresó un compromiso. Corresponde No hubo acuerdo.',
    note: 'Contacto con titular sin acuerdo. Registrar No hubo acuerdo y definir la próxima acción autorizada.',
  },
];

export type GuidedCaseState = {
  progress: Record<GuidedBlockKey, { index: number; finished: boolean }>;
  sourceOpen: boolean; informationPractice: boolean;
  balance: string; greeting: string; holder: string; advisor: string; portfolio: string;
  qualityAnswer: string; informationPortfolio: string; informationBalance: string; informationQuestion: string;
  alternativePractice: { index: number; answers: PaymentAlternative[] };
  registrationAnswer: string;
  registrationAnswers: RegistrationOutcome[];
};
export type DraftField = { [Key in keyof GuidedCaseState]: GuidedCaseState[Key] extends string ? Key : never }[keyof GuidedCaseState];
export function isGuidedBlock(key: string): key is GuidedBlockKey { return Object.hasOwn(GUIDED_BLOCKS, key); }
export function createGuidedCaseState(): GuidedCaseState {
  return {
    progress: { preparacion: { index: 0, finished: false }, contacto: { index: 0, finished: false }, alternativas: { index: 0, finished: false }, seguimiento: { index: 0, finished: false } },
    sourceOpen: false, informationPractice: false, balance: '', greeting: 'Buenos días', holder: '', advisor: '', portfolio: '',
    qualityAnswer: '', informationPortfolio: '', informationBalance: '', informationQuestion: '', alternativePractice: { index: 0, answers: [] }, registrationAnswer: '', registrationAnswers: [],
  };
}
const normalized = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
const normalizedAmount = (text: string) => text.trim().replace(/[$\s.]/g, '').replace(/,00$/, '');
function choiceError(choices: Choice[], value: string): string {
  const choice = choices.find((item) => item.value === value);
  return choice ? choice.feedback : 'Elige una respuesta para continuar.';
}
function registrationError(state: GuidedCaseState): string {
  const exercise = REGISTRATION_PRACTICE[state.progress.seguimiento.index];
  if (!REGISTRATION_RESULTS.some((result) => result.value === state.registrationAnswer)) return 'Elige una tipificación para comprobar tu respuesta.';
  if (state.registrationAnswer !== exercise.expected) return exercise.feedback;
  return '';
}
export function answerAlternativePractice(state: GuidedCaseState, answer: PaymentAlternative): string {
  const practice = state.alternativePractice;
  const exercise = ALTERNATIVE_PRACTICE[practice.index];
  if (!exercise) return '';
  if (!PAYMENT_ALTERNATIVES.some((item) => item.key === answer)) return 'Elige una de las cuatro posibilidades.';
  if (answer !== exercise.expected) return exercise.feedback[answer];
  practice.answers.push(answer);
  practice.index += 1;
  return '';
}
function alternativesPracticed(state: GuidedCaseState): boolean {
  const practice = state.alternativePractice;
  return practice.index === ALTERNATIVE_PRACTICE.length && practice.answers.length === ALTERNATIVE_PRACTICE.length && ALTERNATIVE_PRACTICE.every((exercise, index) => practice.answers[index] === exercise.expected);
}
// Avanza solo la práctica de este bloque. El servidor conserva el desbloqueo entre bloques.
export function advanceGuidedCase(state: GuidedCaseState, block: GuidedBlockKey): string {
  const progress = state.progress[block];
  if (progress.finished) return '';
  const step = GUIDED_BLOCKS[block].steps[progress.index];
  let error = '';
  switch (step.key) {
    case 'saldo':
      if (!state.sourceOpen) error = 'Consulta primero la fuente del ejercicio. El saldo inicial puede estar desactualizado.';
      else if (normalizedAmount(state.balance) !== '400000') error = 'La fuente confirma y aplica el abono de $80.000. El saldo vigente es $400.000. Revisa el valor e inténtalo de nuevo.';
      break;
    case 'saludo': if (normalized(state.holder) !== 'camila rojas') error = 'La ficha corresponde a Camila Rojas. Pregunta por la persona correcta.'; break;
    case 'presentacion':
      if (!state.advisor.trim()) error = 'Escribe tu nombre para que la titular sepa quién le habla.';
      else if (normalized(state.portfolio) !== normalized(PORTFOLIO)) error = `La cartera asignada es ${PORTFOLIO}. Revisa a quién representas.`;
      break;
    case 'calidad': error = choiceError(QUALITY_ANSWERS, state.qualityAnswer); break;
    case 'escucha':
      if (!state.informationPractice) error = 'Lee el guion y pulsa «Practicar sin mirar» para hacer el ejercicio.';
      else if (normalized(state.informationPortfolio) !== normalized(PORTFOLIO)) error = `Informa a qué cartera corresponde el saldo: ${PORTFOLIO}.`;
      else if (normalizedAmount(state.informationBalance) !== '400000') error = 'El saldo vigente que debes informar es $400.000. Usa el valor verificado, sin recargos ni aproximaciones.';
      else error = choiceError(INFORMATION_QUESTIONS, state.informationQuestion);
      break;
    case 'posibilidad': if (!alternativesPracticed(state)) error = 'Completa los cuatro casos rápidos: Pago total, Abono + fechas, Descuento con el líder y Fecha Acuerdo Pago total.'; break;
    case 'registro':
      error = registrationError(state);
      if (!error) {
        state.registrationAnswers.push(REGISTRATION_PRACTICE[progress.index].expected);
        state.registrationAnswer = '';
      }
      break;
  }
  if (!error) {
    progress.index += 1;
    progress.finished = progress.index === GUIDED_BLOCKS[block].steps.length;
  }
  return error;
}
export function caseGreeting(state: GuidedCaseState): string {
  return `${state.greeting}. ¿Me comunico con la señora ${state.holder.trim() || '[nombre de la titular]'}?`;
}
export function casePresentation(state: GuidedCaseState): string {
  return `Mi nombre es ${state.advisor.trim() || '[tu nombre]'}, me comunico de ${AGENCY} para ${state.portfolio.trim() || '[nombre de la cartera]'}. ¡Espero se encuentre muy bien!`;
}
export function caseInformation(): string {
  return `Señora Camila, su saldo pendiente con ${PORTFOLIO} es de $400.000. ${PAYMENT_QUESTION}`;
}
