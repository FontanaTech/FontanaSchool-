import { escapar } from '../http';
import { decorateTutorFeedback } from '../tutor/feedback';
import { icon } from './concepts-slider';
import { showSelectedCollectionOptions } from './ui';
import { mountAlternativeDrill } from './alternative-drill';
import { mountQuickChallenge, type QuickChallengeCase, type QuickChallengeState } from './quick-challenge';
import {
  AGENCY, PORTFOLIO, QUALITY_NOTICE, CLIENT_REPLY, GUIDED_BLOCKS,
  QUALITY_ANSWERS, INFORMATION_QUESTIONS, PAYMENT_QUESTION, REGISTRATION_RESULTS, REGISTRATION_PRACTICE,
  PAYMENT_ALTERNATIVES,
  advanceGuidedCase, caseGreeting, casePresentation, caseInformation,
  type GuidedCaseState, type GuidedBlockKey, type GuidedStepKey, type DraftField,
} from './guided-case-model';

type Options = { block: GuidedBlockKey; onContinue: () => void; saving: boolean; error: string };

export function mountGuidedCase(root: HTMLElement, state: GuidedCaseState, options: Options): void {
  const guide = GUIDED_BLOCKS[options.block];
  const progress = state.progress[options.block];
  let feedback = '';
  let clearTutor: (() => void) | undefined;
  function focus(selector: string): void { root.querySelector<HTMLElement>(selector)?.focus(); }
  function input(name: DraftField, label: string, placeholder: string, extra = ''): string {
    return `<label class="collections-plan-field" for="case-${name}">${label}<input id="case-${name}" data-case-field="${name}" value="${escapar(state[name])}" placeholder="${placeholder}" required maxlength="80" ${extra}></label>`;
  }
  function select(name: DraftField, label: string, choices: { value: string; text: string }[]): string {
    return `<label class="collections-plan-field" for="case-${name}">${label}<select id="case-${name}" data-case-field="${name}" required><option value="">Elige una respuesta</option>${choices.map((choice) => `<option value="${choice.value}"${state[name] === choice.value ? ' selected' : ''}>${escapar(choice.text)}</option>`).join('')}</select></label>`;
  }
  const script = (text: string, preview = false) => `<blockquote class="collections-plan-script"${preview ? ' data-case-preview' : ''}>${escapar(text)}</blockquote>`;
  const reply = (text = CLIENT_REPLY) => `<div class="collections-plan-reply"><span>CAMILA RESPONDE</span><p>«${escapar(text)}»</p></div>`;
  const submitButton = (label: string) => `<button class="collections-primary" type="submit">${label}</button>`;
  function balanceScript(): string {
    return `<div class="collections-balance-script"><span>DI ESTO A LA TITULAR</span><blockquote>Señora Camila, su saldo pendiente con <strong>${PORTFOLIO}</strong> es de <strong class="collections-balance-amount">$400.000.</strong><br><span>${PAYMENT_QUESTION}</span></blockquote></div>`;
  }
  function alternativesHtml(): string {
    const symbols = [
      icon('<circle cx="32" cy="32" r="23"/><path d="m20 32 8 8 16-17"/>'),
      icon('<rect x="9" y="15" width="46" height="40" rx="5"/><path d="M9 27h46M21 8v14M43 8v14M18 36h9M36 36h9M18 45h9M36 45h9"/>'),
      icon('<path d="m32 8 20 8v14c0 12-8 21-20 26-12-5-20-14-20-26V16zM23 32l6 6 13-14"/>'),
      icon('<rect x="9" y="15" width="46" height="40" rx="5"/><path d="M9 27h46M21 8v14M43 8v14m-24 18 8 8 15-15"/>'),
    ];
    // El reto rápido de alternativas se monta aparte, con la misma entidad que el reto que inicia el módulo
    // (medidor, opciones con letra, veredicto con tutor, auto-avance y transiciones). Ver mountAlternativeDrill.
    return `<div class="collections-alternative-layout"><div class="collections-payment-paths">${PAYMENT_ALTERNATIVES.map((alternative, index) => `<article><span aria-hidden="true">${symbols[index]}</span><div><h5>${index + 1}. ${alternative.title}</h5><p>${alternative.explanation}</p><small>${alternative.reminder}</small></div></article>`).join('')}</div>
      <div data-alternative-drill></div></div>`;
  }
  function registrationHtml(): string { return '<div data-registration-drill></div>'; }
  function registrationCases(): readonly QuickChallengeCase[] {
    return REGISTRATION_PRACTICE.map((exercise) => ({
      concept: 'Cierre y seguimiento',
      prompt: exercise.situation,
      choices: REGISTRATION_RESULTS.map((result) => ({
        text: result.text,
        correct: result.value === exercise.expected,
        feedback: result.value === exercise.expected ? exercise.feedback : `Esta gestión corresponde a ${REGISTRATION_RESULTS.find((item) => item.value === exercise.expected)?.text ?? 'otra tipificación'}.`,
      })),
    }));
  }
  function taskHtml(step: GuidedStepKey): string {
    switch (step) {
      case 'saldo': return `<dl class="collections-case-facts"><div><dt>Titular</dt><dd>Camila Rojas</dd></div><div><dt>Saldo inicial</dt><dd>$480.000</dd></div><div><dt>Vencimiento</dt><dd>10/11/2026</dd></div><div><dt>Contacto anterior</dt><dd>Reportó un abono de $80.000, pendiente de verificar.</dd></div></dl>
        <p>Verifica qué cambió antes de preparar el contacto.</p>
        <button type="button" class="collections-plan-source" data-case-source aria-expanded="${state.sourceOpen}" aria-controls="case-source">${state.sourceOpen ? '✓ Actualización consultada' : 'Consultar saldo actualizado →'}</button>
        <div id="case-source"${state.sourceOpen ? '' : ' hidden'} class="collections-plan-ledger"><span>FUENTE AUTORIZADA SOLO PARA ESTE CASO FICTICIO</span><dl><div><dt>Actualización</dt><dd>12/11/2026</dd></div><div><dt>Saldo anterior</dt><dd>$480.000</dd></div><div><dt>Abono confirmado y aplicado</dt><dd>− $80.000</dd></div><div><dt>Saldo vigente</dt><dd>$400.000</dd></div></dl></div>
        ${input('balance', '¿Qué saldo vas a informar?', 'Escribe el saldo vigente', 'inputmode="numeric" autocomplete="off"')}${submitButton('Verificar saldo →')}`;
      case 'saludo': return `<p>La ficha corresponde a <strong>Camila Rojas</strong>. Saluda y pregunta por ella.</p>
        <label class="collections-plan-field" for="case-greeting">Saludo<select id="case-greeting" data-case-field="greeting"><option${state.greeting === 'Buenos días' ? ' selected' : ''}>Buenos días</option><option${state.greeting === 'Buenas tardes' ? ' selected' : ''}>Buenas tardes</option></select></label>
        ${input('holder', '¿Por quién preguntas?', 'Nombre de la titular', 'autocomplete="off"')}${script(caseGreeting(state), true)}${submitButton('Saludar →')}`;
      case 'presentacion': return `${reply('Sí, habla Camila. ¿Con quién hablo?')}<p>Representas a <strong>${AGENCY}</strong> para <strong>${PORTFOLIO}</strong>.</p>
        ${input('advisor', 'Tu nombre como asesor', 'Ejemplo: Patricia Jaramillo', 'autocomplete="given-name"')}${input('portfolio', 'Cartera que representas', 'Nombre de la cartera asignada', 'autocomplete="off"')}
        ${script(casePresentation(state), true)}<p class="collections-plan-hint">La respuesta al saludo aún no verifica la identidad. Sigue el protocolo interno antes de compartir información de la deuda.</p>${submitButton('Presentarme →')}`;
      case 'calidad': return `<p class="collections-quality-scenario">Simulación · Grabación y monitoreo activos</p>
        <div class="collections-quality-message"><span aria-hidden="true">${icon('<rect x="23" y="8" width="18" height="30" rx="9"/><path d="M15 29v3a17 17 0 0 0 34 0v-3M32 49v9M23 58h18"/>')}</span><div><h6>Esto es lo que debes informar</h6><p>La llamada está siendo <strong>grabada y monitoreada</strong> por efectos de <strong>calidad</strong>.</p></div></div>
        ${reply('¿Para qué graban y monitorean esta llamada?')}${select('qualityAnswer', '¿Qué le respondes?', QUALITY_ANSWERS)}${submitButton('Responder y continuar →')}`;
      case 'escucha': return `<p class="collections-balance-identity">✓ Titular verificada en esta simulación.</p>
        ${balanceScript()}${state.informationPractice ? `
          <fieldset class="collections-balance-recall"><legend>Ahora dilo tú</legend><p>Completa el mensaje que le darías a Camila.</p>
            ${input('informationPortfolio', '1. ¿Con qué cartera tiene el saldo?', 'Escribe la cartera', 'autocomplete="off"')}
            ${input('informationBalance', '2. ¿Cuál es el saldo pendiente?', 'Escribe el saldo', 'inputmode="numeric" autocomplete="off"')}
            ${select('informationQuestion', '3. ¿Cómo terminas para escucharla?', INFORMATION_QUESTIONS)}
          </fieldset>${submitButton('Comprobar y escuchar a Camila →')}`
          : `<p class="collections-balance-instruction">Léelo en voz alta. Recuerda: <strong>cartera → saldo → pregunta</strong>.</p><button type="button" class="collections-primary" data-case-practice>Practicar sin mirar →</button>`}`;
      case 'posibilidad': return alternativesHtml();
      case 'registro': return registrationHtml();
    }
  }
  // Ventana con el guion que el asesor acabó de practicar (bloque Contacto). Se abre sola al completar el guion y
  // también con el botón «Ver el guion»; su botón principal la cierra y continúa al siguiente bloque.
  function scriptDialogHtml(): string {
    return `<dialog class="collections-script-dialog" id="collections-script-dialog" aria-labelledby="script-dialog-title">
      <button type="button" class="collections-script-dialog__close" data-script-close aria-label="Cerrar la ventana del guion">×</button>
      <p class="collections-kicker">GUION PRACTICADO · CASO FICTICIO</p>
      <h4 id="script-dialog-title" tabindex="-1" autofocus>Este es el guion que realizaste</h4>
      <div class="collections-call-summary"><h5>Saludo</h5><p>${escapar(caseGreeting(state))}</p><h5>Presentación</h5><p>${escapar(casePresentation(state))}</p><h5>Calidad</h5><p>${QUALITY_NOTICE}</p><p class="collections-plan-identity">Identidad verificada dentro del escenario antes de hablar de la deuda.</p><h5>Información y escucha</h5><p>${escapar(caseInformation())}</p></div>
      <button type="button" class="collections-primary" data-script-continue>${escapar(guide.nextLabel)}</button>
    </dialog>`;
  }
  function completionHtml(): string {
    let summary = '';
    if (options.block === 'preparacion') summary = '<p class="collections-plan-success">Saldo verificado: $400.000 · Abono anterior aplicado: $80.000.</p>';
    if (options.block === 'contacto') summary = `<p class="collections-plan-success">✓ Informaste la cartera, el saldo verificado y abriste la conversación con una pregunta.</p>${reply()}<button type="button" class="collections-secondary" data-script-open>Ver el guion que practicaste</button>${scriptDialogHtml()}`;
    if (options.block === 'alternativas') summary = '<p class="collections-plan-success">✓ Cuatro casos completados: Pago total, Abono + fechas, Descuento con el líder y Fecha Acuerdo Pago total.</p>';
    if (options.block === 'seguimiento') summary = '<p class="collections-plan-success collections-plan-success--avatar-only" aria-label="Resultado guardado"></p>';
    return `<div class="collections-dossier-complete"><p class="collections-kicker">${guide.steps.length} DE ${guide.steps.length} PASOS COMPLETADOS</p><h4 id="guided-detail-title" tabindex="-1">${guide.doneTitle}</h4><p>${guide.doneText}</p>${summary}<button type="button" data-case-continue class="collections-primary"${options.saving ? ' disabled' : ''}>${options.saving ? 'Guardando…' : guide.nextLabel}</button></div>`;
  }
  function render(): void {
    clearTutor?.();
    const current = guide.steps[progress.index];
    const fullWidth = options.block === 'alternativas' || options.block === 'seguimiento';
    const stepNav = fullWidth ? '' : `<aside class="collections-plan-actions" aria-label="Pasos de este bloque"><ol class="collections-plan-slots">${guide.steps.map((step, index) => `<li class="${index < progress.index ? 'is-done' : index === progress.index ? 'is-active' : ''}"${index === progress.index ? ' aria-current="step"' : ''}><span class="collections-plan-number" aria-hidden="true">${index + 1}</span><strong>${step.title}</strong><small>${index < progress.index ? '✓ Completado' : index === progress.index ? 'Estás aquí · ' + step.short : 'Después del paso ' + index}</small></li>`).join('')}</ol></aside>`;
    root.innerHTML = `<section class="collections-dossier" aria-labelledby="guided-case-title" aria-busy="${options.saving}">
      <header class="collections-dossier-head"><div><p>CASO FICTICIO F-204 · ${options.block === 'seguimiento' ? 'PRACTICA DISTINTOS ESCENARIOS DE CIERRE' : 'CONTINÚA LA MISMA GESTIÓN'}</p><h3 id="guided-case-title">El caso de Camila Rojas</h3></div><span class="collections-dossier-badge">Paso a paso</span></header>
      <div class="collections-plan-workspace${fullWidth ? ' collections-plan-workspace--wide' : ''}">${stepNav}
      <section class="collections-dossier-detail" aria-labelledby="guided-detail-title">${progress.finished ? completionHtml() : `${fullWidth ? '' : `<p class="collections-kicker">PASO ${progress.index + 1} DE ${guide.steps.length}</p>`}<h4 id="guided-detail-title" tabindex="-1">${progress.index + 1}. ${current.title}</h4>${progress.index ? `<p class="collections-case-confirmation" role="status">✓ Paso ${progress.index} completado. Sigue con ${current.title.toLocaleLowerCase('es')}.</p>` : ''}<form data-case-form>${taskHtml(current.key)}</form>`}
      ${feedback && !fullWidth ? `<p class="collections-dossier-feedback is-wrong" id="guided-feedback" role="alert" tabindex="-1">${escapar(feedback)} Puedes volver a intentarlo.</p>` : ''}
      ${options.error ? `<p id="collections-error" class="collections-submit-error" role="alert" tabindex="-1">${escapar(options.error)}</p>` : ''}</section></div>
      <p class="collections-dossier-note">Caso y datos de cliente ficticios · Nombres de entidades tomados del guion de referencia · Grabación, monitoreo e identidad verificada son supuestos del escenario · Guion y condiciones reales pendientes de validación interna.</p>
    </section>`;
    const message = root.querySelector<HTMLElement>('#guided-feedback')
      ?? root.querySelector<HTMLElement>('.collections-plan-success')
      ?? root.querySelector<HTMLElement>('.collections-case-confirmation');
    if (message) clearTutor = decorateTutorFeedback(message, feedback ? 'support' : progress.finished ? 'complete' : 'success');
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-case-field]').forEach((field) => field.addEventListener('input', () => {
      state[field.dataset.caseField as DraftField] = field.value;
      const preview = root.querySelector('[data-case-preview]');
      if (preview) preview.textContent = current.key === 'saludo' ? caseGreeting(state) : casePresentation(state);
    }));
    const drillHost = root.querySelector<HTMLElement>('[data-alternative-drill]');
    // El reto rápido se maneja solo (reintentos, auto-avance y transiciones); al resolver los cuatro casos avisa
    // para que el caso guiado cierre el bloque y muestre su pantalla de fin.
    if (drillHost && !progress.finished) mountAlternativeDrill(drillHost, state, { onComplete: () => {
      feedback = advanceGuidedCase(state, options.block);
      render(); focus(feedback ? '#guided-feedback' : '#guided-detail-title');
    } });
    const registrationHost = root.querySelector<HTMLElement>('[data-registration-drill]');
    if (registrationHost && !progress.finished) {
      const challengeState: QuickChallengeState = { index: 0, answers: [], finished: false };
      mountQuickChallenge(registrationHost, challengeState, {
        cases: registrationCases(),
        continueLabel: guide.nextLabel,
        saving: options.saving,
        error: options.error,
        onContinue: options.onContinue,
        onFinished: () => {
          state.registrationAnswers = REGISTRATION_PRACTICE.map((exercise) => exercise.expected);
          state.registrationAnswer = '';
          progress.index = REGISTRATION_PRACTICE.length;
          progress.finished = true;
          render();
          focus('guided-detail-title');
        },
      });
    }
    root.querySelector('[data-case-practice]')?.addEventListener('click', () => { state.informationPractice = true; feedback = ''; render(); focus('#case-informationPortfolio'); });
    root.querySelector('[data-case-source]')?.addEventListener('click', () => { state.sourceOpen = true; render(); focus('[data-case-source]'); });
    // Ventana del guion (bloque Contacto): se puede reabrir con «Ver el guion»; su botón principal cierra y continúa.
    const scriptDialog = root.querySelector<HTMLDialogElement>('#collections-script-dialog');
    if (scriptDialog) {
      root.querySelector('[data-script-open]')?.addEventListener('click', () => { if (!scriptDialog.open) scriptDialog.showModal(); });
      root.querySelector('[data-script-close]')?.addEventListener('click', () => scriptDialog.close());
      root.querySelector('[data-script-continue]')?.addEventListener('click', () => { scriptDialog.close(); if (!options.saving) options.onContinue(); });
    }
    root.querySelector('[data-case-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (options.saving || progress.finished) return;
      feedback = advanceGuidedCase(state, options.block);
      render();
      // Al completar el guion de Contacto, la ventana se abre sola (ella gestiona el foco); en los demás casos, foco normal.
      if (!feedback && progress.finished && options.block === 'contacto') root.querySelector<HTMLDialogElement>('#collections-script-dialog')?.showModal();
      else focus(feedback ? '#guided-feedback' : '#guided-detail-title');
    });
    root.querySelector('[data-case-continue]')?.addEventListener('click', () => { if (progress.finished && !options.saving) options.onContinue(); });
    showSelectedCollectionOptions(root);
  }
  render();
}
