import './tutor.css';
import { BLINK, EXPRESSIONS, FRAME_GEOMETRY, IDLE_BLINK_INTERVAL_MS, IDLE_FRAME, frameUrl, type FrameId, type TutorExpression } from './manifest';

// Tutor pixel art: un componente reutilizable que muestra cuadros PNG por estado. No usa CSS para deformar la imagen
// (solo respira y entra con pequeños desplazamientos). Quien lo usa decide qué cuadro mostrar (por ejemplo, el
// hablante sincroniza la boca con la voz); en reposo parpadea de vez en cuando.
export type Tutor = {
  // Descarga y decodifica cuadros antes de usarlos (caché compartida: cada PNG se descarga una sola vez).
  preload(ids: readonly FrameId[]): Promise<void>;
  // Muestra un cuadro concreto y detiene el reposo.
  hold(id: FrameId): void;
  // Vuelve al reposo (sonrisa con parpadeo ocasional).
  rest(): void;
  react(expression: TutorExpression): void;
  // Detiene gestos mientras se escribe; el contenido y la validación no dependen del avatar.
  pauseAmbient(paused: boolean): void;
  destroy(): void;
};

const loaded = new Map<FrameId, Promise<void>>();
function loadFrame(id: FrameId): Promise<void> {
  let pending = loaded.get(id);
  if (!pending) {
    const image = new Image();
    image.decoding = 'async';
    image.src = frameUrl(id);
    pending = image.decode().catch(() => undefined);
    loaded.set(id, pending);
  }
  return pending;
}
const ensure = (ids: readonly FrameId[]): Promise<void> => Promise.all(ids.map(loadFrame)).then(() => undefined);

export function createTutor(host: HTMLElement, options: { ambient?: boolean } = {}): Tutor {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ambient = options.ambient !== false;
  host.classList.add('tutor');
  host.classList.toggle('is-quiet', !ambient);
  host.style.setProperty('--tutor-ratio', `${FRAME_GEOMETRY.width} / ${FRAME_GEOMETRY.height}`);
  host.setAttribute('aria-hidden', 'true'); // acompaña al contenido; toda la información está en texto normal
  host.innerHTML = '<div class="tutor-figure"></div>';
  const figure = host.querySelector<HTMLElement>('.tutor-figure')!;
  const images = new Map<FrameId, HTMLImageElement>();
  let current: FrameId | null = null;
  let timer: number | undefined;
  let run = 0;
  let destroyed = false;
  let wake: (() => void) | null = null;
  let paused = false;
  let mode: 'idle' | 'held' | 'reacting' = 'idle';

  // Un <img> por cuadro, apilados: cambiar de cuadro es alternar visibilidad (sin recargas ni parpadeo).
  function show(id: FrameId): void {
    if (destroyed || id === current) return;
    let image = images.get(id);
    if (!image) {
      image = document.createElement('img');
      image.className = 'tutor-frame';
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.src = frameUrl(id);
      figure.append(image);
      images.set(id, image);
    }
    if (current) images.get(current)!.classList.remove('is-visible');
    image.classList.add('is-visible');
    current = id;
  }
  function cancel(): number {
    window.clearTimeout(timer);
    wake?.(); wake = null;
    return ++run;
  }
  const wait = (ms: number, token: number): Promise<boolean> => new Promise((resolve) => {
    timer = window.setTimeout(() => resolve(token === run && !destroyed), ms);
    wake = () => resolve(false);
  });

  // Reposo con parpadeo ocasional: un único temporizador activo (no se acumulan bucles).
  async function idle(token: number): Promise<void> {
    show(IDLE_FRAME);
    if (motion.matches || paused || document.hidden) return;
    let blinks = 0;
    while (token === run && !destroyed) {
      const [min, max] = IDLE_BLINK_INTERVAL_MS;
      if (!(await wait(min + Math.random() * (max - min), token))) return;
      if (document.hidden) continue;
      for (const step of BLINK) { show(step.frame); if (!(await wait(step.ms, token))) return; }
      show(IDLE_FRAME);
      if (ambient && ++blinks % 3 === 0) {
        if (!(await wait(1200, token))) return;
        show(blinks % 2 === 0 ? 'rest-look-right' : 'rest-tilt');
        if (!(await wait(650, token))) return;
        show(IDLE_FRAME);
      }
    }
  }
  const startIdle = (): void => { mode = 'idle'; delete host.dataset.expression; void idle(cancel()); };
  function react(expression: TutorExpression): void {
    if (destroyed) return;
    const token = cancel(); mode = 'reacting';
    const sequence = EXPRESSIONS[expression];
    void ensure(sequence.map(step => step.frame)).then(async () => {
      if (destroyed || token !== run || paused || document.hidden) return;
      host.dataset.expression = expression;
      if (motion.matches) {
        show(sequence[0]!.frame);
        if (!(await wait(1400, token))) return;
      } else for (const step of sequence) { show(step.frame); if (!(await wait(step.ms, token))) return; }
      if (token === run) { delete host.dataset.expression; startIdle(); }
    });
  }
  const visibility = () => {
    if (document.hidden) { cancel(); show(IDLE_FRAME); }
    else if (mode !== 'held') startIdle();
  };
  const preference = () => { if (mode !== 'held') startIdle(); };
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', preference);

  const ambientFrames: FrameId[] = ambient ? ['rest-look-right', 'rest-tilt'] : [];
  // Mostrar el avatar desde el primer instante; la precarga continúa en segundo plano.
  show(IDLE_FRAME);
  const ready = ensure([IDLE_FRAME, ...BLINK.map((step) => step.frame), ...ambientFrames]).then(() => {
    if (destroyed) return;
    if (current === null) show(IDLE_FRAME);
    host.classList.add('is-ready');
    if (run === 0) startIdle();
  });

  return {
    async preload(ids) { await ready; await ensure(ids); },
    hold(id) { if (!destroyed) { mode = 'held'; delete host.dataset.expression; cancel(); show(id); } },
    rest() { if (!destroyed) startIdle(); },
    react,
    pauseAmbient(next) {
      if (destroyed || paused === next) return;
      paused = next;
      host.classList.toggle('is-quiet', next || !ambient);
      if (next) { cancel(); show(IDLE_FRAME); }
      else if (mode !== 'held') startIdle();
    },
    destroy() {
      destroyed = true; cancel();
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', preference);
      host.innerHTML = '';
      host.classList.remove('tutor', 'is-ready', 'is-quiet');
      delete host.dataset.expression;
    },
  };
}
