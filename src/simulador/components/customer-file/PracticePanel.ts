// Panel de la prueba de tipificación, arriba de la ficha del cliente: audio de la llamada y los checkmarks de lo que
// debe tener la tipificación. Al guardar, el sistema experto los llena (✓ cumple · ✗ falta, con la explicación).
// Dentro de Fontana School la prueba es oficial: califica el servidor, cada ejercicio tiene un intento y el
// resultado queda guardado (recargar el clon o limpiar el navegador no lo cambia). En el clon suelto o en modo
// repaso es una práctica libre que se puede repetir.

import type { SimContext } from '../../context';
import type { Evaluation } from '../../domain/expert/engine';
import type { CustomerView } from '../../types/simulator';
import { EXERCISE_PORTFOLIO, EXERCISES, type Exercise } from '../../domain/expert/exercises';
import {
  assignedNumbers, isEmbedded, isOfficial, isOfficialExercise, notifyResults, officialExercise, officialState, toEvaluation, type OfficialExercise,
} from '../../domain/expert/official';

/** Las llamadas de la prueba de este asesor: las dos que le tocaron (oficial) o las seis (práctica libre). */
function mine(): Exercise[] {
  const numbers = assignedNumbers();
  return numbers ? EXERCISES.filter((exercise) => numbers.includes(exercise.number)) : EXERCISES;
}
import { combine, on, qs, type Cleanup } from '../../utils/dom';
import { esc, formatCOP } from '../../utils/format';
import { hydrateIcons, icon } from '../icons';
import { openModal } from '../Modal';

export interface PracticePanel {
  showEvaluation(evaluation: Evaluation, official?: OfficialExercise | null): void;
  /** Vuelve a dibujar el panel cuando llega (o cambia) el estado oficial de la prueba. */
  refreshOfficial(): void;
  /** Pasa al siguiente ejercicio, o a los resultados si era el último. */
  goNext(): void;
  /** ¿Es el último ejercicio de la prueba? */
  isLast: boolean;
  cleanup: Cleanup;
}

function stepState(ctx: SimContext, exercise: Exercise, current: Exercise): string {
  if (exercise.id === current.id) return 'current';
  const official = isOfficialExercise(exercise.number) ? officialExercise(exercise.number) : null;
  if (official) return official.result ? 'ok' : 'pending';
  const r = ctx.store.get().practice.results[exercise.id];
  return r?.approved ? 'ok' : r ? 'bad' : 'pending';
}

function progressTemplate(ctx: SimContext, current: Exercise): string {
  return mine().map((e, position) => {
    const state = stepState(ctx, e, current);
    const official = isOfficialExercise(e.number) ? officialExercise(e.number) : null;
    return `<li class="sim-practice__step is-${state}" title="Ejercicio ${e.number}: ${esc(e.title)}${official ? ` · ${esc(official.statusLabel)}` : ''}">${state === 'ok' ? '✓' : position + 1}</li>`;
  }).join('');
}

function checklistTemplate(exercise: Exercise, evaluation?: Evaluation): string {
  return exercise.rules
    .map((rule) => {
      const item = evaluation?.items.find((i) => i.id === rule.id && i.label === rule.label);
      const state = !item ? 'pending' : item.ok ? 'ok' : 'bad';
      return `<li class="sim-check-item is-${state}">
        <span class="sim-check-item__box" aria-hidden="true">${state === 'ok' ? '✓' : state === 'bad' ? '✗' : ''}</span>
        <span><strong>${esc(rule.goal ?? rule.label)}</strong>${item ? `<small>${item.ok ? '' : `${esc(rule.label)}. `}${esc(item.detail)}</small>` : ''}</span>
        <span class="sim-visually-hidden">${state === 'ok' ? 'cumple' : state === 'bad' ? 'no cumple' : 'pendiente'}</span>
      </li>`;
    })
    .join('');
}

async function showSummary(ctx: SimContext): Promise<void> {
  const official = isOfficial() ? officialState() : null;
  ctx.store.endPractice();
  if (official) {
    const pendingRows = official.exercises.filter((e) => !e.result).length;
    const embedded = isEmbedded();
    await openModal(ctx.root, {
      actions: embedded ? [{ label: 'Continuar al examen final', value: 'finish', kind: 'primary' }] : undefined,
      title: 'Tu prueba oficial de tipificación',
      wide: true,
      body: `
        <p class="sim-practice__summary"><strong>${official.completedCount} de ${official.total}</strong> ejercicios completados</p>
        <table class="sim-table sim-table--compact"><thead><tr><th>Ejercicio</th><th>Coincidencia con la llamada</th><th>Estado</th></tr></thead><tbody>
        ${official.exercises.map((e) => `<tr><td>${esc(EXERCISES[e.number - 1]?.title ?? '')}</td><td>${e.result?.score ? `${Math.round(Number(e.result.score))} %` : '—'}</td><td>${esc(e.statusLabel)}</td></tr>`).join('')}
        </tbody></table>
        <p class="sim-help">${official.passed ? 'Completaste tus ejercicios de tipificación. Tu conocimiento se confirma en el examen general: ya puedes presentarlo.' : pendingRows ? 'Aún tienes ejercicios por presentar. Cada uno se presenta una sola vez.' : ''}</p>`,
    });
    // Dentro de la plataforma, cerrar los resultados saca al asesor del simulador hacia el examen final.
    if (embedded) notifyResults();
    return;
  }
  const results = ctx.store.get().practice.results;
  const done = EXERCISES.filter((e) => results[e.id]);
  const approved = EXERCISES.filter((e) => results[e.id]?.approved).length;
  const average = done.length ? Math.round(done.reduce((s, e) => s + results[e.id]!.score, 0) / EXERCISES.length) : 0;
  await openModal(ctx.root, {
    title: 'Resultado de la práctica de tipificación',
    wide: true,
    body: `
      <p class="sim-practice__summary"><strong>${approved} de ${EXERCISES.length}</strong> llamadas tipificadas correctamente · puntaje promedio <strong>${average} %</strong></p>
      <table class="sim-table sim-table--compact"><thead><tr><th>Ejercicio</th><th>Puntaje</th><th>Intentos</th><th>Estado</th></tr></thead><tbody>
      ${EXERCISES.map((e) => {
        const r = results[e.id];
        return `<tr><td>${e.number}. ${esc(e.title)}</td><td>${r ? `${r.score} %` : '—'}</td><td>${r?.attempts ?? 0}</td><td>${r?.approved ? '✓ Aprobado' : r ? '✗ Por mejorar' : 'Sin presentar'}</td></tr>`;
      }).join('')}
      </tbody></table>
      <p class="sim-help">Esta es una práctica libre: no cuenta como evaluación oficial y puedes repetirla cuando quieras.</p>`,
  });
}

/**
 * En la prueba, la zona de «Información Personal» muestra la llamada: el audio y lo mínimo del deudor para tipificar
 * (nombre, identificación, teléfono marcado y saldo). MP3 primero (suena en cualquier navegador) y Opus de respaldo.
 */
export function callCardTemplate(exercise: Exercise, v: CustomerView): string {
  return `
    <div class="sim-call-card" data-sim-guide="prueba.audio">
      <div class="sim-call-card__player">
        <p class="sim-call-card__title">${icon('Headphones')} Llamada del ejercicio ${exercise.number}: ${esc(exercise.title)}</p>
        <audio controls preload="metadata" data-call-audio>
          <source src="${esc(exercise.audio)}.mp3" type="audio/mpeg" />
          <source src="${esc(exercise.audio)}.ogg" type="audio/ogg; codecs=opus" />
          Tu navegador no reproduce el audio.
        </audio>
        <ol class="sim-call-card__steps">
          <li>Escucha la llamada completa (sube el volumen de tu equipo).</li>
          <li>Tipifícala abajo en <strong>«Nueva Gestión»</strong>: acción, contacto, canal, perfil, motivo, teléfono y la gestión escrita.</li>
          <li>Pulsa <strong>«Guardar»</strong>: el sistema experto revisa tu tipificación y llena los checkmarks.</li>
        </ol>
      </div>
      <dl class="sim-call-card__data">
        <div><dt>Nombre</dt><dd>${esc(v.name.toUpperCase())}</dd></div>
        <div><dt>Identificación</dt><dd>${esc(v.document)}</dd></div>
        <div><dt>Teléfono marcado</dt><dd>${esc(v.phone.replace(/\s/g, ''))}</dd></div>
        <div><dt>Saldo total</dt><dd>${esc(formatCOP(v.totalBalance))}</dd></div>
      </dl>
    </div>`;
}

const nextButton = (isLast: boolean, size = ''): string =>
  `<button type="button" class="sim-btn sim-btn--primary${size}" data-practice="next">${isLast ? `${icon('Check')} Ver resultados` : `Siguiente ejercicio ${icon('ArrowRight')}`}</button>`;

/** Resultado del sistema experto junto al formulario «Nueva Gestión». En la prueba oficial es solo retroalimentación. */
function resultTemplate(evaluation: Evaluation, isLast: boolean, attempts: number, official?: OfficialExercise | null): string {
  const missing = evaluation.items.filter((i) => !i.ok);
  if (official) {
    return `
    <div class="sim-expert-result is-feedback" role="status">
      <p class="sim-expert-result__title">${icon('ClipboardList')} Retroalimentación de tu tipificación: ${evaluation.passed} de ${evaluation.total} puntos (${evaluation.score} %)</p>
      <p class="sim-expert-result__note">Tu ejercicio quedó registrado. Las respuestas y su corrección no están disponibles después del envío.</p>
      <div class="sim-expert-result__actions">
        ${nextButton(isLast, ' sim-btn--sm')}
      </div>
    </div>`;
  }
  const head = `Sistema experto: ${evaluation.approved ? `tipificación correcta (${evaluation.score} %)` : `${evaluation.passed} de ${evaluation.total} puntos (${evaluation.score} %) · intento ${attempts}`}`;
  return `
    <div class="sim-expert-result ${evaluation.approved ? 'is-ok' : 'is-bad'}" role="status">
      <p class="sim-expert-result__title">${icon(evaluation.approved ? 'CircleCheck' : 'TriangleAlert')} ${esc(head)}</p>
      ${missing.length ? `<ul class="sim-expert-result__list">${missing.map((i) => `<li><strong>✗ ${esc(i.label)}.</strong> ${esc(i.detail)}</li>`).join('')}</ul>` : '<p>Cumpliste todos los puntos de esta llamada.</p>'}
      <div class="sim-expert-result__actions">
        <button type="button" class="sim-btn sim-btn--ghost sim-btn--sm" data-practice="checks">${icon('ClipboardList')} Ver los checkmarks</button>
        ${evaluation.approved ? '' : `<button type="button" class="sim-btn sim-btn--ghost sim-btn--sm" data-practice="retry">${icon('RotateCcw')} Intentar de nuevo</button>`}
        ${nextButton(isLast, ' sim-btn--sm')}
      </div>
    </div>`;
}

function scoreLine(evaluation: Evaluation, official: OfficialExercise | null | undefined, attempts: number): string {
  if (official) return `<strong>Tu ejercicio quedó registrado: ${evaluation.passed} de ${evaluation.total} puntos (${evaluation.score} %).</strong> Revisa la retroalimentación.`;
  if (evaluation.approved) return `<strong class="is-ok">✓ Tipificación correcta (${evaluation.score} %).</strong> Pasa al siguiente ejercicio.`;
  return `<strong class="is-bad">${evaluation.passed} de ${evaluation.total} puntos (${evaluation.score} %).</strong> Revisa lo marcado con ✗ e inténtalo de nuevo. Intento ${attempts}.`;
}

export function mountPracticePanel(host: HTMLElement, ctx: SimContext, exercise: Exercise, opts: { onRetry(): void; resultSlot: HTMLElement }): PracticePanel {
  const list = mine();
  const position = list.findIndex((item) => item.number === exercise.number);
  const isLast = position === list.length - 1;
  const draw = (): void => {
    const official = isOfficialExercise(exercise.number);
    host.innerHTML = `
      <section class="sim-card sim-practice" data-sim-guide="prueba.panel" aria-labelledby="sim-practice-title">
        <header class="sim-practice__head">
          <div>
            <p class="sim-practice__kicker">${icon('ClipboardList')} ${official ? 'Prueba oficial' : 'Práctica'} de tipificación · Ejercicio ${position + 1} de ${list.length}</p>
            <h2 id="sim-practice-title" class="sim-practice__title">${esc(exercise.title)}</h2>
            <p class="sim-practice__brief">${esc(exercise.brief)} La llamada está abajo, donde va la información del deudor; tipifícala en «Nueva Gestión» y pulsa «Guardar».${official ? ' <strong>Tienes un solo intento:</strong> revisa bien antes de guardar.' : ''}</p>
          </div>
          <ol class="sim-practice__steps" aria-label="Avance de la prueba" data-progress>${progressTemplate(ctx, exercise)}</ol>
        </header>
        <div class="sim-practice__checks" data-sim-guide="prueba.checks">
          <p class="sim-practice__subtitle">Lo que debe tener esta tipificación</p>
          <ol class="sim-check-list" data-checks>${checklistTemplate(exercise)}</ol>
        </div>
        <footer class="sim-practice__foot">
          <p class="sim-practice__score" data-score aria-live="polite">Escucha el audio completo antes de tipificar.</p>
          <div class="sim-practice__actions">
            <button type="button" class="sim-btn sim-btn--ghost" data-practice="retry" hidden>${icon('RotateCcw')} Intentar de nuevo</button>
            ${nextButton(isLast)}
          </div>
        </footer>
      </section>`;
    hydrateIcons(host);
  };
  draw();

  const checks = (): HTMLElement => qs(host, '[data-checks]');
  const score = (): HTMLElement => qs(host, '[data-score]');
  let shown: Evaluation | null = null;

  const render = (evaluation: Evaluation, officialInfo: OfficialExercise | null | undefined, attempts: number): void => {
    shown = evaluation;
    checks().innerHTML = officialInfo ? '' : checklistTemplate(exercise, evaluation);
    qs<HTMLElement>(host, '.sim-practice__checks').hidden = Boolean(officialInfo);
    qs(host, '[data-progress]').innerHTML = progressTemplate(ctx, exercise);
    score().innerHTML = scoreLine(evaluation, officialInfo, attempts);
    qs<HTMLElement>(host, '[data-practice="retry"]').hidden = evaluation.approved || Boolean(officialInfo);
    // El resultado aparece junto al formulario, donde el asesor está mirando.
    opts.resultSlot.innerHTML = resultTemplate(evaluation, isLast, attempts, officialInfo);
    hydrateIcons(opts.resultSlot);
  };

  // Ejercicio oficial ya entregado: se muestra su resultado guardado en el servidor.
  const showSaved = (): void => {
    const saved = isOfficial() ? officialExercise(exercise.number) : null;
    if (saved?.result && !saved.canSubmit) render(toEvaluation(saved.result), saved, 1);
  };
  showSaved();

  const goNext = (): void => {
    if (!isLast) ctx.navigate(`/cartera/${EXERCISE_PORTFOLIO}/cliente/${list[position + 1]!.customer.id}`);
    // Dentro de la plataforma los resultados finales los muestra la página (con el paso al examen final).
    else if (isEmbedded() && isOfficial()) notifyResults();
    else void showSummary(ctx);
  };

  return {
    isLast,
    goNext,
    showEvaluation(evaluation, officialInfo) {
      const missing = evaluation.items.filter((i) => !i.ok).map((i) => i.label);
      const attempts = officialInfo ? 1 : ctx.store.recordPractice(exercise.id, evaluation.score, evaluation.approved, missing).attempts;
      render(evaluation, officialInfo, attempts);
      opts.resultSlot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    refreshOfficial() {
      if (shown) return;
      draw();
      showSaved();
    },
    cleanup: combine([
      () => {
        host.innerHTML = '';
        opts.resultSlot.innerHTML = '';
      },
      ...[host, opts.resultSlot].map((el) => on(el, 'click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-practice]');
        const action = button?.dataset.practice;
        if (action === 'retry') {
          checks().innerHTML = checklistTemplate(exercise);
          score().textContent = 'Corrige la tipificación y vuelve a guardar.';
          opts.resultSlot.innerHTML = '';
          opts.onRetry();
        } else if (action === 'checks') {
          host.querySelector('.sim-practice')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else if (action === 'next') {
          goNext();
        }
      })),
    ]),
  };
}

interface PracticeStatus {
  official: boolean;
  total: number;
  /** Presentados (oficial) o con al menos un intento (práctica libre). */
  done: number;
  /** Aprobados / con todos los puntos cubiertos. */
  correct: number;
  allDone: boolean;
  note: string;
  cta: 'start' | 'continue' | null;
}

/** Resume el avance de la prueba de tipificación para mostrarlo en la lista de clientes. */
function buildStatus(ctx: SimContext): PracticeStatus | null {
  if (isOfficial()) {
    const st = officialState();
    if (!st) return null;
    const total = st.total;
    const done = st.completedCount;
    let met = 0;
    let unmet = 0;
    for (const e of st.exercises) {
      if (e.result?.typification) {
        met += e.result.typification.metCount;
        unmet += e.result.typification.unmetCount;
      }
    }
    const allDone = st.passed || done >= total;
    const note = done === 0
      ? 'Aún no has presentado ningún ejercicio. Cada llamada se presenta una sola vez.'
      : allDone
        ? unmet > 0
          ? `Cubriste ${met} de ${met + unmet} puntos en total. Ya puedes presentar el examen general.`
          : '¡Cubriste todos los puntos! Ya puedes presentar el examen general.'
        : `Te falta${total - done === 1 ? '' : 'n'} ${total - done} por presentar.${unmet > 0 ? ` En los presentados te faltaron ${unmet} punto${unmet === 1 ? '' : 's'}.` : ''}`;
    return { official: true, total, done, correct: done, allDone, note, cta: allDone ? null : done === 0 ? 'start' : 'continue' };
  }
  const results = ctx.store.get().practice.results;
  const total = EXERCISES.length;
  const done = EXERCISES.filter((e) => results[e.id]).length;
  const correct = EXERCISES.filter((e) => results[e.id]?.approved).length;
  const allDone = correct >= total;
  // Puntos que quedaron pendientes en las llamadas aún no aprobadas (sin repetir).
  const pendingMissing = [...new Set(
    EXERCISES.filter((e) => results[e.id] && !results[e.id]!.approved).flatMap((e) => results[e.id]!.missing),
  )];
  const note = done === 0
    ? 'Aún no has tipificado ninguna llamada. Puedes repetir esta práctica cuando quieras.'
    : allDone
      ? '¡Tipificaste correctamente todas las llamadas! Puedes repasarlas cuando quieras.'
      : pendingMissing.length
        ? `Te faltó: ${pendingMissing.slice(0, 3).join(', ')}${pendingMissing.length > 3 ? '…' : ''}.`
        : `Te falta${total - correct === 1 ? '' : 'n'} ${total - correct} por mejorar.`;
  return { official: false, total, done, correct, allDone, note, cta: allDone ? null : done === 0 ? 'start' : 'continue' };
}

/**
 * Tarjeta de resumen de la prueba para la lista de clientes de la campaña de práctica:
 * «X de N» y qué puntos faltan. Devuelve '' cuando no hay nada que mostrar.
 */
export function practiceStatusTemplate(ctx: SimContext): string {
  // En la plataforma esperamos el estado oficial antes de mostrar nada (evita textos de práctica libre).
  if (isEmbedded() && !officialState()) return '';
  const s = buildStatus(ctx);
  if (!s) return '';
  const kicker = s.official ? 'Prueba de tipificación' : 'Práctica de tipificación';
  const unit = s.official ? 'ejercicios' : 'llamadas';
  const progress = s.official ? `${s.done} de ${s.total}` : `${s.correct} de ${s.total}`;
  const ctaLabel = s.cta === 'start'
    ? s.official ? 'Iniciar la prueba' : 'Iniciar la práctica'
    : s.cta === 'continue'
      ? s.official ? 'Continuar la prueba' : 'Continuar la práctica'
      : '';
  return `
    <section class="sim-card sim-practice-status${s.allDone ? ' is-done' : ''}" aria-label="Avance de tu prueba de tipificación">
      <div class="sim-practice-status__info">
        <p class="sim-practice-status__kicker">${icon(s.allDone ? 'CircleCheck' : 'ClipboardList')} ${kicker}</p>
        <p class="sim-practice-status__progress"><strong>${esc(progress)}</strong> ${unit}</p>
        <p class="sim-practice-status__note">${esc(s.note)}</p>
      </div>
      ${s.cta ? `<button type="button" class="sim-btn sim-btn--primary" data-action="practice-start">${icon('Headphones')} ${ctaLabel}</button>` : ''}
    </section>`;
}

/** Lleva al primer ejercicio sin aprobar (o al primero) y activa la prueba. */
export function startPractice(ctx: SimContext, restart = false): void {
  ctx.store.startPractice(restart);
  const official = isOfficial() ? officialState() : null;
  const results = ctx.store.get().practice.results;
  const next = official
    ? mine().find((e) => officialExercise(e.number)?.canSubmit) ?? mine().find((e) => officialExercise(e.number)?.status !== 'COMPLETADO') ?? mine()[0]!
    : EXERCISES.find((e) => !results[e.id]?.approved) ?? EXERCISES[0]!;
  ctx.navigate(`/cartera/${EXERCISE_PORTFOLIO}/cliente/${next.customer.id}`);
}
