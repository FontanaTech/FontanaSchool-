import { escapar } from '../http';
import { decorateTutorFeedback } from '../tutor/feedback';
import {
  ALTERNATIVE_PRACTICE, PAYMENT_ALTERNATIVES, answerAlternativePractice,
  type GuidedCaseState, type PaymentAlternative,
} from './guided-case-model';

// Tiempo mínimo para leer «¡Correcto!» antes de pasar solo; crece con la longitud del texto (igual que el reto rápido).
const CORRECT_BASE_MS = 1800;
const CORRECT_PER_CHAR_MS = 35;

// Confirmación breve por acierto (misma redacción que mostraba el drill anterior).
const SUCCESS_TEXT: Record<PaymentAlternative, string> = {
  total: '✓ Pago total: cubre toda la deuda.',
  abono: '✓ Abono: acuerda fechas para cancelar lo pendiente.',
  descuento: '✓ Descuento: primero valida con tu líder; después ofrece lo autorizado.',
  'fecha-total': '✓ Fecha Acuerdo Pago total: registra el monto completo y la fecha acordada. Es un compromiso, no un pago confirmado.',
};

type Pick = { answer: PaymentAlternative; correct: boolean; feedback: string };
type DrillOptions = { onComplete: () => void };

/**
 * Reto rápido de alternativas con la MISMA entidad visual, de transiciones y de interacción que el reto que inicia
 * el módulo (mountQuickChallenge): medidor de progreso, opciones con letra, marcas ✓/✕, tarjeta de veredicto con el
 * tutor, auto-avance al acertar y transición de salida/entrada entre casos. La lógica la decide el modelo
 * (answerAlternativePractice): reintenta hasta acertar y exige los cuatro casos; por eso, a diferencia del reto de
 * conceptos, un error NO revela la opción correcta (así el reintento conserva su valor). Al completar los cuatro,
 * avisa con onComplete para que el caso guiado cierre el bloque.
 */
export function mountAlternativeDrill(root: HTMLElement, state: GuidedCaseState, options: DrillOptions): void {
  const total = ALTERNATIVE_PRACTICE.length;
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const letter = (i: number) => String.fromCharCode(65 + i);

  let view = state.alternativePractice.index; // caso que se está pintando (el modelo ya avanzó su índice al acertar)
  let pick: Pick | undefined;                 // selección y veredicto del caso en curso (solo presentación)
  let locked = false;                         // tras acertar, se bloquea hasta que entra el siguiente caso
  let advancing = false;
  let entryMotion: 'initial' | 'next' = 'initial';
  let timer: number | undefined;
  let clearTutor: (() => void) | undefined;

  const choicesHtml = (): string => PAYMENT_ALTERNATIVES.map((alternative, i) => {
    const chosen = pick?.answer === alternative.key;
    const mark = pick && chosen ? (pick.correct ? 'is-correct' : 'is-wrong') : '';
    const glyph = pick && chosen ? (pick.correct ? '✓' : '✕') : letter(i);
    // Al acertar se bloquean todas; al fallar siguen activas para reintentar (sin revelar la correcta).
    return `<button type="button" data-drill-answer="${alternative.key}" aria-pressed="${chosen}"${pick?.correct ? ' disabled' : ''} class="${mark}"><span aria-hidden="true">${glyph}</span>${escapar(alternative.title)}</button>`;
  }).join('');

  const verdictHtml = (): string => {
    if (!pick) return '';
    return `<div class="collections-quick-verdict ${pick.correct ? 'is-correct' : 'is-wrong'}" role="status" id="drill-feedback" tabindex="-1">
        <strong>${pick.correct ? '¡Correcto!' : 'Esa no encaja'}</strong>
        <p>${escapar(pick.correct ? SUCCESS_TEXT[pick.answer] : pick.feedback)}</p>
      </div>`;
  };

  const footerHtml = (): string => {
    if (!pick) return '<span>Si aciertas, avanzas automáticamente.</span>';
    if (pick.correct) return `<span>${view + 1 === total ? 'Terminando el reto…' : 'Pasando al siguiente caso…'}</span>`;
    return '<span>Lee la pista y vuelve a intentarlo.</span>';
  };

  const decorate = (): void => {
    clearTutor?.(); clearTutor = undefined;
    const message = root.querySelector<HTMLElement>('#drill-feedback');
    if (message) clearTutor = decorateTutorFeedback(message, pick?.correct ? 'success' : 'support');
  };

  const wireChoices = (section: HTMLElement): void => {
    section.querySelectorAll<HTMLButtonElement>('[data-drill-answer]').forEach((button) =>
      button.addEventListener('click', () => choose(button.dataset.drillAnswer as PaymentAlternative)));
  };

  // Reconstruye la tarjeta completa solo al abrir un caso nuevo (reproduce la animación de entrada).
  function render(): void {
    clearTutor?.(); clearTutor = undefined;
    const exercise = ALTERNATIVE_PRACTICE[view];
    if (!exercise) { options.onComplete(); return; } // defensivo: no debería montarse con los cuatro casos resueltos
    root.innerHTML = `<section class="collections-quick-challenge collections-quick-challenge--card" data-motion="${entryMotion}" aria-labelledby="drill-title">
      <header><h3 id="drill-title" tabindex="-1">Reto rápido</h3><span>${view + 1} de ${total}</span></header>
      <div class="collections-quick-meter" role="progressbar" aria-label="Casos resueltos" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${view}">${ALTERNATIVE_PRACTICE.map((_, position) => `<span class="${position < view ? 'is-complete' : position === view ? 'is-current' : ''}"></span>`).join('')}</div>
      <p class="collections-quick-caption">Alternativas · Caso ficticio · ¿Qué posibilidad encaja?</p>
      <h4 id="drill-question" tabindex="-1">Camila dice: «${escapar(exercise.quote)}»</h4>
      <div class="collections-quick-choices" role="group" aria-labelledby="drill-question">${choicesHtml()}</div>
      <footer>${footerHtml()}</footer>
    </section>`;
    wireChoices(root);
  }

  // Responder solo actualiza opciones, veredicto y pie: la tarjeta no se reconstruye ni repite su entrada.
  function choose(answer: PaymentAlternative): void {
    if (advancing || locked) return;
    const feedback = answerAlternativePractice(state, answer); // '' si acierta (el modelo ya avanzó su índice)
    const correct = feedback === '';
    pick = { answer, correct, feedback };
    const section = root.querySelector<HTMLElement>('.collections-quick-challenge');
    if (!section) return;
    section.classList.remove('is-correct', 'is-wrong');
    section.classList.add(correct ? 'is-correct' : 'is-wrong');
    section.querySelector('.collections-quick-choices')!.innerHTML = choicesHtml();
    section.querySelector('#drill-feedback')?.remove();
    section.querySelector('.collections-quick-choices')!.insertAdjacentHTML('afterend', verdictHtml());
    section.querySelector('footer')!.innerHTML = footerHtml();
    wireChoices(section);
    decorate();
    root.querySelector<HTMLElement>('#drill-feedback')?.focus({ preventScroll: true });
    if (correct) { locked = true; schedule(); }
  }

  // Sale la tarjeta anterior y, cuando termina de salir, entra la siguiente; así no se superponen.
  function advance(): void {
    if (advancing) return;
    advancing = true;
    window.clearTimeout(timer);
    const section = root.querySelector<HTMLElement>('.collections-quick-challenge');
    const swap = (): void => {
      if (!advancing) return;
      advancing = false;
      if (!root.isConnected) return;
      locked = false; pick = undefined;
      view = state.alternativePractice.index;
      if (view >= total) { options.onComplete(); return; } // cuatro casos resueltos: lo cierra el caso guiado
      entryMotion = 'next';
      render();
      root.querySelector<HTMLElement>('#drill-question')?.focus({ preventScroll: true });
    };
    if (!section || calm()) { swap(); return; }
    section.classList.add('is-leaving');
    section.addEventListener('transitionend', (event) => { if (event.target === section && event.propertyName === 'opacity') swap(); });
    window.setTimeout(swap, 400); // respaldo si el navegador no emite el fin de la transición
  }

  // Un acierto avanza solo cuando hubo tiempo de leer la confirmación.
  function schedule(): void {
    if (!pick?.correct) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { if (root.isConnected) advance(); }, CORRECT_BASE_MS + SUCCESS_TEXT[pick.answer].length * CORRECT_PER_CHAR_MS);
  }

  render();
}
