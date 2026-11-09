// Puente con la plataforma para la prueba oficial de tipificación. Dentro de Fontana School (iframe), el clon no
// califica: envía lo que el asesor tipificó a la página padre, que lo manda al servidor. El servidor califica con el
// mismo sistema experto, guarda el intento (uno por ejercicio) y devuelve el resultado. Fuera de la plataforma
// (clon suelto) o en modo repaso, la práctica se califica aquí mismo y no cuenta como evaluación.

import type { TypificationDraft } from '../typification/draft';
import type { Evaluation } from './engine';

// Tipifica no se aprueba ni se reprueba: un ejercicio presentado queda COMPLETADO y trae su retroalimentación.
export type OfficialStatus = 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADO';

export interface OfficialCheck { id: string; ok: boolean; detail: string; label?: string; goal?: string }
export interface OfficialResult {
  attemptId: string;
  number: number;
  score: string | null;
  passed: boolean;
  submittedAt: string | null;
  typification?: { metCount: number; unmetCount: number };
}
export interface OfficialExercise {
  number: number;
  status: OfficialStatus;
  statusLabel: string;
  canSubmit: boolean;
  reactivationRequestedAt: string | null;
  result: OfficialResult | null;
}
export interface OfficialState {
  reviewMode: boolean;
  passed: boolean;
  completedCount: number;
  total: number;
  exercises: OfficialExercise[];
}

type Reply = { type: 'tipifica:respuesta'; requestId: string; ok: boolean; data?: unknown; error?: string; state?: OfficialState };

let current: OfficialState | null = null;
const listeners = new Set<(state: OfficialState) => void>();
const pending = new Map<string, { resolve(value: Reply): void }>();
const embedded = typeof window !== 'undefined' && window.parent !== window;

function setState(state: OfficialState): void {
  current = state;
  for (const listener of listeners) listener(state);
}

if (embedded) {
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data as { type?: string; state?: OfficialState; requestId?: string } | null;
    if (data?.type === 'tipifica:estado' && data.state) setState(data.state);
    if (data?.type === 'tipifica:respuesta' && data.requestId) {
      const reply = data as Reply;
      if (reply.state) setState(reply.state);
      pending.get(reply.requestId)?.resolve(reply);
      pending.delete(reply.requestId);
    }
  });
  // Avisa a la plataforma que el clon cargó para recibir el estado de la prueba.
  window.parent.postMessage({ type: 'tipifica:listo' }, location.origin);
}

/** ¿La prueba cuenta como evaluación oficial? Solo dentro de la plataforma y fuera del modo repaso. */
export function isOfficial(): boolean {
  return embedded && current !== null && !current.reviewMode;
}

/** ¿El clon está dentro de la plataforma? Ahí la prueba es oficial en cuanto llega su estado. */
export function isEmbedded(): boolean {
  return embedded;
}

/** Espera el estado oficial (llega de la plataforma al cargar). Sin respuesta en 8 s devuelve null. */
export function whenOfficialReady(): Promise<OfficialState | null> {
  if (!embedded || current) return Promise.resolve(current);
  window.parent.postMessage({ type: 'tipifica:listo' }, location.origin);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { stop(); resolve(null); }, 8000);
    const stop = onOfficialState((state) => { clearTimeout(timer); stop(); resolve(state); });
  });
}

export function officialState(): OfficialState | null {
  return current;
}

/** Números de ejercicio que le tocan al asesor en la prueba oficial (null fuera de la plataforma o en repaso). */
export function assignedNumbers(): number[] | null {
  return isOfficial() ? current!.exercises.map((exercise) => exercise.number) : null;
}

/** ¿Este ejercicio es uno de los asignados al asesor (cuenta como evaluación oficial)? */
export function isOfficialExercise(number: number): boolean {
  return isOfficial() && officialExercise(number) !== null;
}

export function officialExercise(number: number): OfficialExercise | null {
  return current?.exercises.find((exercise) => exercise.number === number) ?? null;
}

export function onOfficialState(listener: (state: OfficialState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ask(type: string, payload: Record<string, unknown>): Promise<Reply> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    pending.set(requestId, { resolve });
    window.parent.postMessage({ type, requestId, ...payload }, location.origin);
    // Sin respuesta en 30 s se informa el error; el servidor no habrá consumido nada que no devuelva luego.
    setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      resolve({ type: 'tipifica:respuesta', requestId, ok: false, error: 'La plataforma no respondió. Revisa tu conexión y vuelve a pulsar «Guardar»: si ya quedó guardado verás tu resultado.' });
    }, 30_000);
  });
}

/** Envía la tipificación para la calificación oficial. */
export async function submitOfficial(number: number, draft: TypificationDraft): Promise<{ result: OfficialResult; alreadySubmitted: boolean }> {
  const reply = await ask('tipifica:evaluar', { number, draft });
  if (!reply.ok) throw new Error(reply.error ?? 'No se pudo guardar el ejercicio.');
  return reply.data as { result: OfficialResult; alreadySubmitted: boolean };
}

/** Avisa a la plataforma que el asesor terminó el último ejercicio y quiere ver sus resultados. */
export function notifyResults(): void {
  window.parent.postMessage({ type: 'tipifica:resultados' }, location.origin);
}

/** Registra que el asesor abrió el ejercicio (fecha de inicio del intento). No consume intentos. */
export function notifyOpened(number: number): void {
  if (isOfficial()) void ask('tipifica:abrir', { number });
}

/** Convierte el resultado del servidor al formato de los checkmarks del clon. */
export function toEvaluation(result: OfficialResult): Evaluation {
  const passed = result.typification?.metCount ?? 0;
  const total = passed + (result.typification?.unmetCount ?? 0);
  return {
    items: [],
    passed,
    total,
    score: Math.round(Number(result.score ?? 0)),
    // Solo para el color de la retroalimentación: todos los puntos coinciden con la llamada. No es aprobación.
    approved: total > 0 && passed === total,
  };
}
