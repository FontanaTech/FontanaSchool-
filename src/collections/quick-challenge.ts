import { escapar } from '../http';
import { decorateTutorFeedback } from '../tutor/feedback';

export type QuickChallengeCase = { concept: string; prompt: string; choices: readonly { text: string; correct: boolean; feedback: string }[] };
const ok = (text: string, feedback: string) => ({ text, correct: true, feedback });
const no = (text: string, feedback: string) => ({ text, correct: false, feedback });

// Retos rápidos de cada bloque: preguntas cortas de dos opciones para afianzar lo visto en las tarjetas.
// La validación formal de conocimientos la hace el examen final.
export const CHALLENGES: Record<string, readonly QuickChallengeCase[]> = {
  conceptos: [
    { concept: 'Producto', prompt: 'Camila pregunta: «¿De dónde sale mi saldo?»', choices: [
      ok('Reviso el detalle en la fuente autorizada y se lo explico.', 'Primero verifica qué se cobra; después explícalo con claridad.'),
      no('Le doy un valor aproximado para responder rápido.', 'Una suposición puede confundir. Revisa el detalle antes de responder.'),
    ] },
    { concept: 'Objeciones', prompt: 'Camila dice: «Este mes no puedo pagar».', choices: [
      no('Insisto en el pago sin preguntar qué pasó.', 'Insistir sin escuchar no ayuda a comprender la dificultad.'),
      ok('Pregunto qué dificultad tiene en este momento.', 'Escuchar primero te ayuda a comprender su situación.'),
    ] },
    { concept: 'Protocolo', prompt: 'Alguien contesta. Aún no has verificado su identidad.', choices: [
      ok('Saludo, me presento y verifico según el guion aprobado.', 'Sigue el protocolo aprobado antes de compartir información de la deuda.'),
      no('Digo el saldo para explicar de inmediato el motivo.', 'Primero verifica la identidad; todavía no compartas datos de la deuda.'),
    ] },
    { concept: 'Marca y cartera', prompt: 'Te asignan una cartera que todavía no conoces.', choices: [
      no('Uso las mismas condiciones de la cartera anterior.', 'Cada cartera puede tener condiciones distintas. Confírmalas internamente.'),
      ok('Confirmo la entidad que represento y cómo funciona esa cartera.', 'Conoce la entidad y las condiciones vigentes antes de gestionar.'),
    ] },
    { concept: 'Negociación', prompt: 'Camila pide un descuento que no tienes autorizado.', choices: [
      ok('Consulto la solicitud sin prometer que será aprobada.', 'Puedes consultar una alternativa; la consulta no garantiza aprobación.'),
      no('Le aseguro el descuento para lograr un acuerdo.', 'No prometas condiciones que aún no están autorizadas.'),
    ] },
  ],
  preparacion: [
    { concept: 'Saldo', prompt: 'El saldo no tiene fecha de actualización.', choices: [
      ok('Verifico su vigencia antes de usarlo.', 'Trabaja con información vigente; no asumas que el saldo sigue igual.'),
      no('Lo uso tal como aparece en pantalla.', 'Ver un dato no demuestra cuándo se actualizó.'),
    ] },
    { concept: 'Hechos y pendientes', prompt: 'Camila dice que ya abonó $80.000.', choices: [
      no('Lo resto del saldo de una vez.', 'Un reporte sin confirmar no permite modificar el saldo.'),
      ok('Lo anoto como reportado, pendiente de verificar.', 'Separas lo que dijo la cliente de lo que está confirmado.'),
    ] },
    { concept: 'Alternativas', prompt: 'En otra cuenta de Camila hubo un descuento.', choices: [
      no('Se lo ofrezco también en esta cuenta.', 'Las condiciones de una cuenta no se trasladan a otra.'),
      ok('Confirmo qué está autorizado para esta cuenta.', 'Cada cuenta tiene sus propias alternativas autorizadas.'),
    ] },
    { concept: 'Información incompleta', prompt: 'No sabes si el canal de contacto está autorizado.', choices: [
      ok('Lo aclaro por la vía interna antes de usarlo.', 'Ante un vacío de información, se pregunta; no se supone.'),
      no('Supongo que sí y contacto de una vez.', 'Completar vacíos con suposiciones pone en riesgo la gestión.'),
    ] },
  ],
  contacto: [
    { concept: 'Inicio', prompt: 'La persona contesta la llamada.', choices: [
      ok('Saludo y me presento con el guion aprobado.', 'Un inicio claro y respetuoso genera confianza.'),
      no('Le digo el saldo de inmediato.', 'Todavía no has verificado la identidad: no compartas datos de la deuda.'),
    ] },
    { concept: 'Identidad', prompt: 'Contesta un familiar de Camila.', choices: [
      no('Le explico la deuda para que le avise.', 'Un tercero no está autorizado a recibir información de la obligación.'),
      ok('No revelo la deuda y sigo la ruta interna.', 'Proteges la información: solo hablas de la deuda con el titular verificado.'),
    ] },
    { concept: 'Escucha', prompt: 'Camila: «Tuve un gasto inesperado».', choices: [
      ok('«Entiendo. ¿Cómo afecta eso tu posibilidad de pago?»', 'Reconoces la situación y preguntas para comprender.'),
      no('«Eso es una excusa; debe pagar».', 'El juicio cierra la conversación y no aporta información.'),
    ] },
    { concept: 'Lo que debes evitar', prompt: 'La persona se molesta durante la llamada.', choices: [
      no('Le advierto que habrá consecuencias.', 'Las amenazas no están permitidas y rompen la conversación.'),
      ok('Mantengo el respeto y sigo escuchando.', 'La calma y el respeto permiten retomar la conversación.'),
    ] },
  ],
  alternativas: [
    { concept: 'Su posibilidad', prompt: 'Antes de proponer una alternativa…', choices: [
      ok('Pregunto qué monto y fecha puede cumplir.', 'Primero comprendes la posibilidad real de la persona.'),
      no('Le impongo un monto y una fecha.', 'Un acuerdo impuesto difícilmente se cumple.'),
    ] },
    { concept: 'Lo autorizado', prompt: 'Su propuesta encaja en la ficha autorizada.', choices: [
      no('Le digo que con ese abono cancela todo.', 'El abono es parcial: el saldo restante sigue pendiente.'),
      ok('La explico y aclaro que el resto sigue pendiente.', 'Explicas solo lo confirmado y sin crear falsas expectativas.'),
    ] },
    { concept: 'Fuera de lo permitido', prompt: 'Camila pide un descuento no autorizado.', choices: [
      no('Lo apruebo para cerrar el acuerdo.', 'Las ganas de cerrar no amplían tus facultades.'),
      ok('Lo consulto con el coordinador, sin prometer.', 'Consultar conserva la solicitud sin garantizar un resultado.'),
    ] },
    { concept: 'Comunicar la consulta', prompt: 'Mientras esperas la respuesta, le dices…', choices: [
      ok('«Lo voy a consultar; aún no está aprobado».', 'Distingues claramente la consulta de la aprobación.'),
      no('«Tranquila, ya quedó aprobado».', 'Esa aprobación todavía no existe.'),
    ] },
  ],
  seguimiento: [
    { concept: 'Cierre', prompt: 'Antes de despedirte de Camila…', choices: [
      ok('Confirmo el monto, la fecha y el alcance del compromiso.', 'Resumir evita malentendidos sobre lo acordado.'),
      no('Termino rápido para pasar al siguiente caso.', 'Sin confirmar, el compromiso puede quedar confuso.'),
    ] },
    { concept: 'La nota', prompt: 'Camila promete abonar $200.000 el día 20.', choices: [
      no('Registro: pago confirmado.', 'Es un compromiso futuro, no un pago verificado.'),
      ok('Registro: compromiso de abono, sin pago confirmado.', 'La nota separa lo acordado de lo que falta verificar.'),
    ] },
    { concept: 'Promesa o pago', prompt: 'El cliente dice: «Ya pagué».', choices: [
      ok('Lo dejo pendiente de verificar en la fuente autorizada.', 'Confirmar un pago exige la fuente autorizada.'),
      no('Lo marco como pagado.', 'Lo que dice el cliente es un reporte, no una confirmación.'),
    ] },
    { concept: 'Próxima acción', prompt: 'Ya registraste el compromiso.', choices: [
      no('Llamo cada hora hasta que pague.', 'No puedes crear reglas de frecuencia de contacto.'),
      ok('Programo el seguimiento según el procedimiento.', 'Cada pendiente necesita una próxima acción autorizada.'),
    ] },
  ],
};

// Tiempo mínimo para leer «¡Correcto!» y su explicación antes de pasar solo; crece con la longitud del texto.
const CORRECT_BASE_MS = 1800;
const CORRECT_PER_CHAR_MS = 35;
const WRONG_BASE_MS = 2600;

export type QuickChallengeState = { index: number; answers: (number | undefined)[]; finished: boolean };

export function mountQuickChallenge(root: HTMLElement, state: QuickChallengeState, options: { cases: readonly QuickChallengeCase[]; continueLabel: string; onContinue: () => void; saving: boolean; error: string; onFinished?: () => void }): void {
  const cases = options.cases;
  let timer: number | undefined;
  let clearTutor: (() => void) | undefined;
  let advancing = false;
  let entryMotion: 'initial' | 'next' = 'initial';
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const selectedChoice = () => { const selected = state.answers[state.index]; return selected === undefined ? undefined : cases[state.index]!.choices[selected]; };
  const choicesHtml = (item: QuickChallengeCase, selected: number | undefined) => item.choices.map((choice, position) => {
    const answer = selected === undefined ? undefined : item.choices[selected];
    const mark = !answer ? '' : choice.correct ? 'is-correct' : selected === position ? 'is-wrong' : 'is-dimmed';
    return `<button type="button" data-quick-answer="${position}" aria-pressed="${selected === position}"${answer ? ' disabled' : ''} class="${mark}"><span aria-hidden="true">${!answer ? String.fromCharCode(65 + position) : choice.correct ? '✓' : selected === position ? '✕' : String.fromCharCode(65 + position)}</span>${escapar(choice.text)}</button>`;
  }).join('');
  const verdictHtml = (item: QuickChallengeCase, selected: number | undefined) => {
    const answer = selected === undefined ? undefined : item.choices[selected];
    if (!answer) return '';
    const right = item.choices.find((choice) => choice.correct)!;
    return `<div class="collections-quick-verdict ${answer.correct ? 'is-correct' : 'is-wrong'}" role="status" id="quick-challenge-feedback" tabindex="-1">
        <strong>${answer.correct ? '¡Correcto!' : 'Respuesta incorrecta'}</strong>
        ${answer.correct ? '' : `<p class="collections-quick-right"><span>Respuesta correcta:</span> ${escapar(right.text)}</p>`}
        <p>${escapar(answer.correct ? answer.feedback : right.feedback)}</p>
      </div>`;
  };
  const footerHtml = (answer: QuickChallengeCase['choices'][number] | undefined) => {
    return !answer ? '<span>Elige una respuesta para continuar automáticamente.</span>'
      : answer.correct ? '<span>Pasando al siguiente reto…</span>'
        : '<span>Lee la corrección. Pasando al siguiente reto…</span>';
  };
  const decorate = () => {
    clearTutor?.(); clearTutor = undefined;
    const message = root.querySelector<HTMLElement>(state.finished ? '.collections-quick-finish' : '#quick-challenge-feedback');
    if (message) clearTutor = decorateTutorFeedback(message, state.finished ? 'complete' : selectedChoice()?.correct ? 'success' : 'support');
  };

  // Cambia la tarjeta completa solo al abrir un reto nuevo o el resultado.
  function render(): void {
    clearTutor?.(); clearTutor = undefined;
    const item = cases[state.index]!;
    const selected = state.answers[state.index];
    const answer = selectedChoice();
    const hits = cases.filter((entry, position) => state.answers[position] !== undefined && entry.choices[state.answers[position]!]!.correct).length;
    root.innerHTML = `<section class="collections-quick-challenge ${state.finished ? '' : answer ? answer.correct ? 'is-correct' : 'is-wrong' : ''}" data-motion="${entryMotion}" aria-labelledby="quick-challenge-title">
      <header><h3 id="quick-challenge-title" tabindex="-1">Reto rápido</h3><span>${state.finished ? 'Completado' : `${state.index + 1} de ${cases.length}`}</span></header>
      <div class="collections-quick-meter" role="progressbar" aria-label="Retos resueltos" aria-valuemin="0" aria-valuemax="${cases.length}" aria-valuenow="${state.finished ? cases.length : state.index}">${cases.map((_, position) => `<span class="${state.finished || position < state.index ? 'is-complete' : position === state.index ? 'is-current' : ''}"></span>`).join('')}</div>
      ${state.finished ? `<div class="collections-quick-emblem" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m7 16 6 6 12-13"/></svg></div><p class="collections-quick-finish" role="status">¡Terminaste el reto! Acertaste ${hits} de ${cases.length}.</p>
      <div class="collections-concepts-continue"><button type="button" data-concept-continue class="collections-primary"${options.saving ? ' disabled' : ''}>${options.saving ? 'Guardando…' : escapar(options.continueLabel)}</button></div>
      ${options.error ? `<p id="collections-error" class="collections-submit-error" role="alert" tabindex="-1">${escapar(options.error)}</p>` : ''}` : `
      <p class="collections-quick-caption">${escapar(item.concept)} · Caso ficticio · Elige una opción.</p>
      <h4 id="quick-challenge-question" tabindex="-1">${escapar(item.prompt)}</h4>
      <div class="collections-quick-choices" role="group" aria-labelledby="quick-challenge-question">${choicesHtml(item, selected)}</div>
      ${verdictHtml(item, selected)}
      <footer>${footerHtml(answer)}</footer>`}
    </section>`;
    decorate();
    root.querySelector('[data-concept-continue]')?.addEventListener('click', options.onContinue);
    root.querySelectorAll<HTMLButtonElement>('[data-quick-answer]').forEach((button) => button.addEventListener('click', () => choose(Number(button.dataset.quickAnswer))));
  }

  // Responder solo actualiza opciones, veredicto y pie: la tarjeta no se reconstruye ni repite su animación de entrada.
  function choose(choice: number): void {
    if (advancing || state.finished || state.answers[state.index] !== undefined) return;
    const item = cases[state.index]!;
    state.answers[state.index] = choice;
    const answer = item.choices[choice]!;
    const section = root.querySelector<HTMLElement>('.collections-quick-challenge')!;
    section.classList.add(answer.correct ? 'is-correct' : 'is-wrong');
    section.querySelector('.collections-quick-choices')!.innerHTML = choicesHtml(item, choice);
    section.querySelector('.collections-quick-choices')!.insertAdjacentHTML('afterend', verdictHtml(item, choice));
    const footer = section.querySelector('footer')!;
    footer.innerHTML = footerHtml(answer);
    decorate();
    root.querySelector<HTMLElement>('#quick-challenge-feedback')?.focus({ preventScroll: true });
    schedule();
  }

  // Sale la tarjeta anterior y, cuando termina de salir, entra la siguiente; así no se superponen.
  function advance(): void {
    if (advancing) return;
    window.clearTimeout(timer);
    const section = root.querySelector<HTMLElement>('.collections-quick-challenge');
    const swap = () => {
      if (!advancing) return;
      advancing = false;
      if (!root.isConnected) return;
      if (state.index === cases.length - 1) state.finished = true; else state.index++;
      entryMotion = 'next';
      render();
      root.querySelector<HTMLElement>(state.finished ? '#quick-challenge-title' : '#quick-challenge-question')?.focus({ preventScroll: true });
      if (state.finished) options.onFinished?.();
    };
    advancing = true;
    if (!section || calm()) { swap(); return; }
    section.classList.add('is-leaving');
    section.addEventListener('transitionend', event => { if (event.target === section && event.propertyName === 'opacity') swap(); });
    window.setTimeout(swap, 400); // respaldo si el navegador no emite el fin de la transición
  }

  // Cualquier respuesta avanza sola después de dar tiempo para leer el resultado.
  function schedule(): void {
    const answer = selectedChoice();
    if (state.finished || !answer) return;
    const index = state.index;
    window.clearTimeout(timer);
    const delay = (answer.correct ? CORRECT_BASE_MS : WRONG_BASE_MS) + answer.feedback.length * CORRECT_PER_CHAR_MS;
    timer = window.setTimeout(() => { if (state.index === index && !state.finished && root.isConnected) advance(); }, delay);
  }
  render();
  schedule();
}
