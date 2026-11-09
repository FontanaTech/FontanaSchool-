// El cupo base es un intento. El segundo requiere la acción expresa del asesor;
// los siguientes solo se habilitan mediante una excepción administrativa.
export const EVALUATION_BASE_ATTEMPTS = 1;
export const selfRetryKey = (userId: string, activityId: string): string => `self-retry:${userId}:${activityId}`;

// Cupo de intentos oficiales de una actividad. Manda, en este orden: el cupo individual que el administrador fijó para
// ese asesor y el de la versión vigente de la evaluación (se cambia en «Módulos y actividades»). Nunca menos de uno.
// Los intentos adicionales por reactivación se suman aparte, como excepciones auditadas.
export function initialEvaluation<T extends { maxAttempts: number; waitMinutes: number }>(evaluation: T, individualLimit?: number | null): T {
  return { ...evaluation, maxAttempts: Math.max(EVALUATION_BASE_ATTEMPTS, individualLimit ?? evaluation.maxAttempts), waitMinutes: 0 };
}
