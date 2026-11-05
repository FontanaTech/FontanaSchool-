export type SecurityAvatar = {
  // Asocia el reproductor: el avatar sigue su estado real (sin temporizadores que inventen la reproducción).
  attach(audio: HTMLAudioElement): void;
  // Vuelve a reposo y detiene la animación (al cambiar de paso o salir de la pestaña).
  stop(): void;
  destroy(): void;
};

export type SecurityAvatarOptions = { dir: string };

// Fotogramas de la lámina de referencia (ver scripts/security/avatar-frames.mjs): f0..f15 en <dir>/fN.webp.
// Cada gesto tiene boca cerrada/abierta en la MISMA pose; algunos tienen ojos cerrados para parpadear sin mover los brazos.
const FRAMES = {
  rest:      { closed: 0, open: 3, blink: [1, 2] },
  point:     { closed: 4, open: 5 },
  pointLeft: { closed: 8, open: 9 },
  fist:      { closed: 12, open: 14, blink: [13] },
} as const;
type Base = keyof typeof FRAMES;

// Coreografía por fracción de la narración (0–1), independiente de la duración: se recalcula al buscar o cambiar velocidad.
const CHOREO: readonly { from: number; base: Base }[] = [
  { from: 0, base: 'rest' }, { from: 0.2, base: 'point' }, { from: 0.5, base: 'pointLeft' },
  { from: 0.74, base: 'fist' }, { from: 0.92, base: 'rest' },
];
function baseAt(fraction: number): Base {
  let base: Base = CHOREO[0]!.base;
  for (const seg of CHOREO) if (fraction >= seg.from) base = seg.base;
  return base;
}

// Índices de fotograma realmente usados (para precargar solo esos, una sola vez por módulo).
const USED = [...new Set(Object.values(FRAMES).flatMap((g) => [g.closed, g.open, ...((g as { blink?: readonly number[] }).blink ?? [])]))];

const BLINK_MS: readonly [number, number] = [3600, 6600];
const REST_DEBOUNCE_MS = 140;
const CHOREO_CYCLE_S = 12; // si el audio no reporta duración, los gestos se recorren por tiempo en ciclos de ~12 s
const OPEN_RMS = 0.05, CLOSE_RMS = 0.028; // histéresis para que la boca no vibre entre abierta y cerrada

// Un solo AudioContext para todo el módulo; cada avatar aporta su fuente y analizador y se cierra al desmontar el último.
let sharedCtx: AudioContext | null = null;
let graphCount = 0;

/**
 * Avatar de Seguridad de la información animado por fotogramas. Mientras la narración suena de verdad, hace una
 * coreografía de gestos y abre/cierra la boca según el VOLUMEN real de la voz (se cierra en los silencios); en pausa,
 * fin, error o carga vuelve a reposo con parpadeo. No es sincronización labial fonética: la boca sigue la intensidad.
 */
export function createSecurityAvatar(host: HTMLElement, { dir }: SecurityAvatarOptions): SecurityAvatar {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  host.classList.add('is-frames');
  host.dataset.avatarState = 'idle';

  // Un <img> por fotograma usado, apilados; cambiar de fotograma = alternar visibilidad (sin recargas ni parpadeo).
  // Los <img> con src se descargan solos (el navegador comparte la caché entre los 6 avatares del módulo). Con
  // movimiento reducido solo se carga el fotograma neutro: los demás nunca se muestran, así que no se descargan.
  const imgs = new Map<number, HTMLImageElement>();
  for (const n of USED) {
    const img = document.createElement('img');
    img.className = 'security-avatar__frame'; img.alt = ''; img.decoding = 'async'; img.draggable = false;
    if (!reduce.matches || n === FRAMES.rest.closed) img.src = `${dir}/f${n}.webp`;
    imgs.set(n, img);
  }
  host.replaceChildren(...imgs.values());
  let current = -1;
  const show = (n: number): void => {
    if (n === current) return;
    imgs.get(current)?.classList.remove('is-on');
    imgs.get(n)?.classList.add('is-on');
    current = n;
  };
  show(FRAMES.rest.closed);

  let audio: HTMLAudioElement | null = null;
  let destroyed = false;
  let mode: 'idle' | 'speaking' = 'idle';
  let raf = 0;
  let blinkTimer = 0;
  let restTimer = 0;
  let mouthOpen = false;
  let analyser: AnalyserNode | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let hasGraph = false;
  const samples = new Uint8Array(128);
  const canAnimate = (): boolean => !destroyed && !reduce.matches;

  // ----- Reposo: neutro con parpadeo ocasional (un solo temporizador encadenado, no se acumulan bucles) -----
  function scheduleBlink(): void {
    window.clearTimeout(blinkTimer); blinkTimer = 0;
    if (!canAnimate() || mode !== 'idle' || document.hidden) return;
    const [min, max] = BLINK_MS;
    blinkTimer = window.setTimeout(() => {
      if (mode !== 'idle' || !canAnimate() || document.hidden) return;
      const seq = [FRAMES.rest.blink[0], FRAMES.rest.blink[1], FRAMES.rest.blink[0], FRAMES.rest.closed];
      let k = 0;
      const step = (): void => {
        if (mode !== 'idle' || destroyed) return;
        show(seq[k]!); k++;
        if (k < seq.length) blinkTimer = window.setTimeout(step, k === 1 || k === 3 ? 70 : 90);
        else scheduleBlink();
      };
      step();
    }, min + Math.floor((max - min) * Math.random()));
  }

  // ----- Hablando: coreografía por posición + boca según el volumen real de la voz -----
  function speakLoop(): void {
    if (destroyed || !audio || mode !== 'speaking') { raf = 0; return; }
    // La coreografía sigue la posición de reproducción (se recalcula al buscar o cambiar velocidad). Si el audio
    // no reporta duración —algunos MP3—, se recorre por tiempo en ciclos para que los gestos avancen igual.
    const dur = audio.duration;
    const fraction = Number.isFinite(dur) && dur > 0 ? audio.currentTime / dur : (audio.currentTime % CHOREO_CYCLE_S) / CHOREO_CYCLE_S;
    const base: Base = baseAt(fraction);
    if (analyser) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) { const c = (s - 128) / 128; sum += c * c; }
      const rms = Math.sqrt(sum / samples.length);
      mouthOpen = mouthOpen ? rms > CLOSE_RMS : rms > OPEN_RMS; // histéresis
    } else {
      mouthOpen = false; // sin análisis de audio no se simula un movimiento de boca falso
    }
    show(FRAMES[base][mouthOpen ? 'open' : 'closed']);
    raf = requestAnimationFrame(speakLoop);
  }

  function ensureGraph(): void {
    if (!canAnimate() || !audio || analyser) return;
    try {
      sharedCtx ??= new AudioContext();
      source = sharedCtx.createMediaElementSource(audio);
      analyser = sharedCtx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser); analyser.connect(sharedCtx.destination);
      hasGraph = true; graphCount++;
    } catch { analyser = null; source = null; } // si el navegador no lo permite, la boca queda cerrada (sin flap falso)
    void sharedCtx?.resume();
  }

  function toSpeaking(): void {
    window.clearTimeout(restTimer); restTimer = 0;
    window.clearTimeout(blinkTimer); blinkTimer = 0;
    host.dataset.avatarState = 'speaking';
    if (!canAnimate()) { show(FRAMES.rest.closed); return; } // movimiento reducido: avatar estático, la voz igual suena
    if (mode === 'speaking') return;
    mode = 'speaking';
    ensureGraph();
    if (!raf) raf = requestAnimationFrame(speakLoop);
  }

  function toIdle(immediate = false): void {
    const go = (): void => {
      restTimer = 0;
      mode = 'idle';
      host.dataset.avatarState = 'idle';
      cancelAnimationFrame(raf); raf = 0;
      mouthOpen = false;
      show(FRAMES.rest.closed);
      scheduleBlink();
    };
    window.clearTimeout(restTimer); restTimer = 0;
    // Pequeño retardo salvo que se pida inmediato: evita parpadear hablando↔reposo ante pausas muy breves o búfer.
    if (immediate) go(); else restTimer = window.setTimeout(go, REST_DEBOUNCE_MS);
  }

  // Fuente de verdad: eventos reales del reproductor. 'playing' = la voz suena de verdad.
  const onPlaying = (): void => toSpeaking();
  const onPause = (): void => { if (!audio?.ended) toIdle(); };
  const onEnded = (): void => toIdle();
  const onWaiting = (): void => toIdle();
  const onError = (): void => toIdle();
  const onVisibility = (): void => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; window.clearTimeout(blinkTimer); blinkTimer = 0; }
    else if (mode === 'idle') scheduleBlink();
    else if (mode === 'speaking' && !raf && canAnimate()) raf = requestAnimationFrame(speakLoop);
  };
  document.addEventListener('visibilitychange', onVisibility);

  const detach = (): void => {
    if (!audio) return;
    audio.removeEventListener('playing', onPlaying);
    audio.removeEventListener('pause', onPause);
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('waiting', onWaiting);
    audio.removeEventListener('error', onError);
    audio = null;
  };

  const releaseGraph = (): void => {
    try { source?.disconnect(); analyser?.disconnect(); } catch { /* ya desconectado */ }
    source = null; analyser = null;
    if (hasGraph) {
      hasGraph = false; graphCount = Math.max(0, graphCount - 1);
      if (graphCount === 0 && sharedCtx) { void sharedCtx.close(); sharedCtx = null; }
    }
  };

  scheduleBlink();

  return {
    attach(next) {
      if (audio === next) return;
      detach();
      audio = next;
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('waiting', onWaiting);
      audio.addEventListener('error', onError);
      if (!audio.paused && !audio.ended) toSpeaking();
    },
    stop() {
      if (audio && !audio.paused) audio.pause();
      toIdle(true);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf); raf = 0;
      window.clearTimeout(blinkTimer); window.clearTimeout(restTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      detach();
      releaseGraph();
      host.replaceChildren();
      host.classList.remove('is-frames');
      delete host.dataset.avatarState;
    },
  };
}
