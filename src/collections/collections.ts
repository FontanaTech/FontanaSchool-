import './collections.css';
import './collections-ui.css';
import { progressGuide } from '../progress-guide';
import { playSeal } from '../seal-animation';
import { api, escapar } from '../http';
import { mountConceptsSlider } from './concepts-slider';
import { mountExam, type ExamResult, type ExamState, type ExamDraft } from './exam';
import { CHALLENGES, mountQuickChallenge, type QuickChallengeState } from './quick-challenge';
import { mountGuidedCase } from './guided-case';
import { createGuidedCaseState, isGuidedBlock } from './guided-case-model';

type Content = { objective: string; explanation: string[]; example: { title: string; paragraphs: string[] }; workedExample: { decision: string; why: string }; validation: string[] };
type Block = { key: string; title: string; enabled: boolean; completed: boolean; content: Content | null };
type State = { name: string; experienced: boolean; diagnosticFirst: boolean; reviewMode: boolean; simulatorRoute: string | null; completedCount: number; percent: number; complete: boolean; currentBlock: string; blocks: Block[]; exam: ExamState };
const BASE = '/training/collections';
const EXAM = 'examen';

// Conceptos conserva sus tarjetas; los bloques 02 a 05 continúan un caso guiado. El asesor nuevo completa el módulo
// con la teoría; el asesor con experiencia presenta antes un examen diagnóstico (un intento) y luego la misma teoría.
export async function mountCollections(container: HTMLElement, backHref: string): Promise<void> {
  container.innerHTML = '<p role="status">Cargando tu inducción a las cobranzas…</p>';
  let state: State;
  let selected: string;
  let saving = false;
  let error = '';
  let examResult: ExamResult | null = null;
  let savingOverlay: HTMLElement | null = null;
  const slides = new Map<string, number>();
  const challenges = new Map<string, QuickChallengeState>();
  const guidedCase = createGuidedCaseState();
  try {
    state = (await api<{ data: State }>(`${BASE}/module`)).data;
    selected = state.currentBlock;
    render();
  } catch (cause) {
    container.innerHTML = `<section class="auth-card collections-error"><h2>No pudimos abrir el módulo</h2><p role="alert">${escapar((cause as Error).message)}</p><a href="${escapar(backHref)}">Volver a tu ruta</a></section>`;
  }

  function current(): Block | undefined { return state.blocks.find((block) => block.key === selected); }
  function challengeOf(key: string): QuickChallengeState {
    if (!challenges.has(key)) challenges.set(key, { index: 0, answers: [], finished: false });
    return challenges.get(key)!;
  }
  function focus(id: string): void { container.querySelector<HTMLElement>(`#${id}`)?.focus(); }
  function setSavingScreen(active: boolean, blockTitle = 'el siguiente bloque'): void {
    savingOverlay?.remove();
    savingOverlay = null;
    container.inert = active;
    if (!active) return;
    const overlay = document.createElement('div');
    overlay.className = 'collections-saving-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'collections-saving-title');
    overlay.setAttribute('aria-describedby', 'collections-saving-detail');
    overlay.innerHTML = `<div class="collections-saving-dialog"><img src="/imagenes/fontana-logo.webp" alt="Fontana" width="64" height="64"><p class="collections-saving-brand">FONTANA SCHOOL</p><span class="collections-saving-spinner" aria-hidden="true"></span><h2 id="collections-saving-title" tabindex="-1">Guardando tu avance</h2><p id="collections-saving-detail" role="status">Estamos conservando tu progreso antes de pasar a ${escapar(blockTitle)}.</p><p class="collections-saving-reminder"><strong>Un momento.</strong> No cierres esta ventana.</p></div>`;
    document.body.append(overlay);
    savingOverlay = overlay;
    overlay.querySelector<HTMLElement>('#collections-saving-title')?.focus({ preventScroll: true });
  }
  function lessonHtml(block: Block): string {
    if (block.key === 'conceptos') return `<p class="fontana-concepts-intro">Cinco claves para iniciar tu gestión.</p><div id="collections-concepts-slider"></div>`;
    if (isGuidedBlock(block.key)) return `${block.key === 'seguimiento' ? `<aside class="collections-reference-card" aria-labelledby="collections-codes-guide-title">
      <div><p class="collections-kicker">CONSULTA RÁPIDA</p><h3 id="collections-codes-guide-title">Guía de códigos de gestión</h3><p>Consulta el instructivo mientras practicas cómo registrar el resultado, el compromiso y el seguimiento de cada gestión.</p></div>
      <a class="collections-reference-link" href="/manuales/codigos-de-gestion.pdf" target="_blank" rel="noopener noreferrer">Abrir instructivo (PDF) <span aria-hidden="true">↗</span></a>
    </aside>` : ''}<div id="collections-guided-case"></div>`;
    return '';
  }
  async function continueBlock(block: Block): Promise<void> {
    if (saving || !(isGuidedBlock(block.key) ? guidedCase.progress[block.key].finished : challengeOf(block.key).finished)) return;
    // La pantalla de carga bloquea la interacción mientras se conserva el avance.
    saving = true; error = '';
    setSavingScreen(true, state.blocks[state.blocks.findIndex((item) => item.key === block.key) + 1]?.title ?? 'el siguiente bloque');
    container.querySelectorAll<HTMLButtonElement>('[data-concept-continue], [data-case-continue]').forEach((button) => { button.disabled = true; button.textContent = 'Guardando…'; });
    container.querySelectorAll('[aria-busy]').forEach((section) => section.setAttribute('aria-busy', 'true'));
    try {
      const wasComplete = state.complete;
      state = (await api<{ data: State }>(`${BASE}/blocks/${block.key}/complete`, { method: 'POST', body: JSON.stringify({}) })).data;
      const next = state.blocks[state.blocks.findIndex((item) => item.key === block.key) + 1];
      selected = next?.enabled ? next.key : block.key;
      if (!wasComplete && state.complete) {
        // Módulo completado. El servidor ya persistió el avance (por eso `state.complete`): solo entonces se otorga el sello.
        // La carga se retira POR COMPLETO antes de presentar el sello. Su overlay tiene mayor z-index (10000) que el sello
        // (1200); si coexistieran, taparía el botón «Continuar» y la pantalla quedaría congelada. Se mantiene `saving` activo
        // durante toda la transición para que un segundo clic no dispare otro envío ni un segundo sello; al terminar se navega
        // (recarga completa de la ruta) y con ello se limpian eventos, temporizadores y animaciones de esta pantalla.
        setSavingScreen(false);
        if (!container.isConnected) return; // el asesor salió del módulo durante el guardado: el avance quedó persistido, no mostramos el sello ni forzamos navegación
        await playSeal({ moduleName: 'Inducción a las cobranzas', moduleNumber: 2, label: 'COMPLETADO', nextName: 'Enfréntate a la objeción' });
        window.location.assign(backHref);
        return;
      }
      saving = false;
      setSavingScreen(false);
      render(); focus('block-title');
    } catch (cause) {
      saving = false; setSavingScreen(false); error = (cause as Error).message; render(); focus('collections-error');
    }
  }
  async function submitExam(answers: Record<string, string>): Promise<void> {
    const { data } = await api<{ data: { result: ExamResult; state: State } }>(`${BASE}/exam`, { method: 'POST', body: JSON.stringify({ answers }) });
    state = data.state;
    examResult = data.result;
    selected = EXAM;
    render(); focus('exam-title');
  }
  function goTheory(): void {
    const target = state.blocks.find((block) => block.enabled && !block.completed) ?? state.blocks.find((block) => block.enabled);
    if (!target) return;
    examResult = null;
    selected = target.key;
    render(); focus('block-title');
  }
  function render(): void {
    const block = current();
    const onExam = selected === EXAM;
    if (!onExam && (!block?.content || !block.enabled)) return;
    const index = block ? state.blocks.indexOf(block) : -1;
    const subtitle = state.diagnosticFirst ? 'Muestra lo que ya sabes con el examen diagnóstico; después recorrerás la teoría del módulo.' : 'Acompaña el caso ficticio de Camila: comprende, decide y aprende.';
    container.innerHTML = `<section class="collections-course collections-course--induction" aria-labelledby="collections-title"><header class="collections-heading fontana-progress-row"><div><p class="collections-kicker">MÓDULO 02 · ${state.experienced ? 'PARA ASESORES CON EXPERIENCIA' : 'PARA ASESORES NUEVOS'}</p><h1 id="collections-title">Inducción a las cobranzas</h1><p>${escapar(subtitle)}</p></div>${progressGuide(backHref)}</header>
      ${state.complete ? '' : `<div class="collections-path-note" role="note"><strong>${state.experienced ? 'Marcaste que tienes experiencia.' : 'Marcaste que eres nuevo.'}</strong> ${state.experienced ? 'Debes presentar primero el examen diagnóstico (un solo intento); después recorrerás el temario de la inducción.' : 'Verás todo el temario de la inducción a las cobranzas, bloque por bloque.'}</div>`}
      ${state.complete ? `<div class="collections-complete" role="status"><strong>¡Completaste la inducción a las cobranzas!</strong><p>Ya tienes habilitado el módulo «Enfréntate a la objeción». Puedes repasar lo aprendido cuando quieras.</p>${state.simulatorRoute ? `<a class="collections-primary" href="${escapar(state.simulatorRoute)}">Ir a «Enfréntate a la objeción» →</a>` : ''}</div>` : ''}
      <div class="collections-layout"><article class="collections-card"><div class="collections-block-heading"><div class="collections-block-toolbar"><p class="collections-kicker">${onExam ? 'EVALUACIÓN DIAGNÓSTICA' : `BLOQUE ${String(index + 1).padStart(2, '0')} DE 05`}</p></div><h2 id="block-title"${!onExam && block!.key === 'conceptos' ? ' class="collections-title-hidden"' : ''} tabindex="-1">${onExam ? 'Examen diagnóstico' : escapar(block!.title)}</h2></div>
      ${onExam ? '<div id="collections-exam"></div>' : lessonHtml(block!)}</article></div></section>`;
    const examRoot = container.querySelector<HTMLElement>('#collections-exam');
    if (examRoot) mountExam(examRoot, {
      exam: state.exam, experienced: state.experienced, theoryLocked: state.diagnosticFirst, simulatorRoute: state.simulatorRoute, backHref,
      result: examResult, submit: submitExam, goTheory,
      start: async () => (await api<{ data: ExamDraft }>(`${BASE}/exam/start`, { method: 'POST', body: JSON.stringify({}) })).data,
      saveSection: async (key, answers) => (await api<{ data: ExamDraft }>(`${BASE}/exam/sections/${key}`, { method: 'POST', body: JSON.stringify({ answers }) })).data,
    });
    if (block) {
      const dossier = container.querySelector<HTMLElement>('#collections-guided-case');
      if (dossier && isGuidedBlock(block.key)) mountGuidedCase(dossier, guidedCase, { block: block.key, onContinue: () => { void continueBlock(block); }, saving, error });
      const last = index === state.blocks.length - 1;
      const challenge = (root: HTMLElement) => mountQuickChallenge(root, challengeOf(block.key), {
        cases: CHALLENGES[block.key] ?? [], continueLabel: last ? 'Completar el módulo →' : 'Continuar al siguiente bloque →',
        onContinue: () => { void continueBlock(block); }, saving, error,
      });
      const onSlide = (position: number) => { slides.set(block.key, position); };
      const concepts = container.querySelector<HTMLElement>('#collections-concepts-slider');
      if (concepts) mountConceptsSlider(concepts, { initialSlide: slides.get(block.key) ?? 0, onSlide, mountChallenge: challenge });
    }
    container.querySelectorAll<HTMLButtonElement>('[data-block]').forEach((button) => button.addEventListener('click', async () => {
      if (saving) return;
      if (button.dataset.block === EXAM) {
        selected = EXAM; error = ''; render(); focus('block-title');
        return;
      }
      const target = state.blocks.find((item) => item.key === button.dataset.block)!;
      if (!target.enabled) return;
      if (!target.content) {
        try { state = (await api<{ data: State }>(`${BASE}/module`)).data; }
        catch (cause) { error = (cause as Error).message; render(); return; }
      }
      selected = target.key; error = '';
      render(); focus('block-title');
    }));
  }
}
