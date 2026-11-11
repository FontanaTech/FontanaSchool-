import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COLLECTIONS_KEYS } from '../domain/collections.js';
import { COLLECTIONS_EXAM, EXAM_SECTIONS, EXAM_DRAFT_KEY, EXAM_KEY } from '../domain/collections-exam.js';

// Repositorio en memoria: comprueba el protocolo de guardado del examen diagnóstico sin abrir ni alterar
// la base de desarrollo. Las pruebas de integración (evaluation-flow) cubren el intento real con PostgreSQL.
const memory = vi.hoisted(() => ({
  rows: [] as any[], experienced: true, legacy: false, moduleProgress: null as any,
  availability: { passed: false, openAttemptId: null as string | null, canStart: true, remaining: 1, nextNumber: 1, exhausted: false },
}));
vi.mock('../config/prisma.js', () => {
  const db: any = {
    usuario: { findUnique: async () => ({ rol: 'asesor', estado: 'activo', debeCompletarDatos: false, tieneExperienciaCobranzasDigitales: memory.experienced }) },
    $queryRaw: async () => [],
    collectionsBlockProgress: {
      findMany: async ({ where }: any) => memory.rows.filter((row) => where.blockKey.in ? where.blockKey.in.includes(row.blockKey) : row.blockKey.startsWith(where.blockKey.startsWith)),
      upsert: async ({ where, create, update }: any) => {
        const key = where.userId_moduleId_blockKey_contentVersion.blockKey;
        let row = memory.rows.find((item) => item.blockKey === key);
        if (!row) { row = { id: key, attempts: 0, completedAt: null, ...structuredClone(create) }; memory.rows.push(row); }
        else {
          const { attempts, ...data } = update;
          Object.assign(row, structuredClone(data));
          if (attempts?.increment) row.attempts += attempts.increment;
        }
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = memory.rows.find((item) => item.id === where.id);
        Object.assign(row, structuredClone(data)); return row;
      },
      create: async ({ data }: any) => {
        if (memory.rows.some((r) => r.blockKey === data.blockKey)) throw new Error('duplicate');
        const row = { id: data.blockKey, ...structuredClone(data) }; memory.rows.push(row); return row;
      },
    },
    reactivationRequest: { findFirst: async () => null },
    userModuleProgress: { findUnique: async () => memory.moduleProgress },
    userActivityProgress: { findUnique: async () => null },
  };
  db.$transaction = async (callback: (tx: any) => Promise<any>) => callback(db);
  return { prisma: db };
});
vi.mock('../services/progress.service.js', () => ({
  completeModule: vi.fn(async () => { memory.moduleProgress = { ...memory.moduleProgress, status: 'PASSED', percent: 100 }; }),
  loadSnapshot: async () => ({
    views: [{ slug: 'induccion-cobranzas', moduleId: 'module', enabled: true, hasSeal: memory.legacy, status: memory.legacy ? 'PASSED' : 'IN_PROGRESS' }],
    modules: [{ id: 'module', activities: [{ id: 'theory', type: 'LESSON', isRequired: true, status: 'ACTIVE' }, { id: 'diagnostic', type: 'QUIZ', isRequired: false, status: 'ACTIVE' }] }],
    availability: new Map([['diagnostic', memory.availability]]),
    certification: { status: 'EN_FORMACION', reason: null },
    // El usuario y el progreso guardado llegan en la misma consulta del estado de formación.
    user: { rol: 'asesor', estado: 'activo', debeCompletarDatos: false, tieneExperienciaCobranzasDigitales: memory.experienced },
    storedModuleProgress: new Map(memory.moduleProgress ? [['module', memory.moduleProgress]] : []),
  }),
}));
// El intento oficial: un solo intento; startAttemptTx retoma el abierto.
vi.mock('../services/attempt.service.js', () => ({
  startAttemptTx: vi.fn(async () => {
    if (!memory.availability.openAttemptId) {
      if (!memory.availability.canStart) throw Object.assign(new Error('Sin intentos'), { code: 'NO_ATTEMPTS_LEFT' });
      memory.availability = { ...memory.availability, openAttemptId: `attempt-${memory.availability.nextNumber}`, canStart: false, remaining: 0, nextNumber: memory.availability.nextNumber + 1 };
    }
    return { attempt: { id: memory.availability.openAttemptId }, resumed: false };
  }),
  submitAttemptTx: vi.fn(async (_tx: unknown, _user: string, _attempt: string, input: { passed: boolean }) => {
    memory.availability = { ...memory.availability, openAttemptId: null, passed: input.passed, exhausted: !input.passed };
  }),
}));
vi.mock('../repositories/progress.repository.js', () => ({
  upsertActivityProgress: vi.fn(),
  upsertModuleProgress: async (_db: unknown, _user: string, _module: string, data: any) => { memory.moduleProgress = data; },
}));
import { collectionsState, completeCollectionsBlock, startCollectionsExam, saveCollectionsExamSection, submitCollectionsExam } from '../services/collections.service.js';
import { submitAttemptTx } from '../services/attempt.service.js';
import { completeModule } from '../services/progress.service.js';

const goodAnswers = () => Object.fromEntries(COLLECTIONS_EXAM.map((q) => [q.key, q.kind === 'text' ? q.example : q.options.find((o) => o.correct)!.id]));
async function saveAll(answers: Record<string, string>) {
  await startCollectionsExam('user');
  for (const section of EXAM_SECTIONS) await saveCollectionsExamSection('user', section.key, Object.fromEntries(section.questions.map((q) => [q.key, answers[q.key]!])));
}
beforeEach(() => {
  memory.rows = [];
  memory.experienced = true; memory.legacy = false; memory.moduleProgress = null;
  memory.availability = { passed: false, openAttemptId: null, canStart: true, remaining: 1, nextNumber: 1, exhausted: false };
  vi.clearAllMocks();
});

describe('examen diagnóstico por secciones', () => {
  it('es solo del asesor con experiencia, va antes de la teoría y bloquea saltos', async () => {
    memory.experienced = false;
    await expect(startCollectionsExam('user')).rejects.toMatchObject({ code: 'DIAGNOSTIC_NOT_APPLICABLE' });
    expect((await collectionsState('user')).diagnosticFirst).toBe(false);
    memory.experienced = true;
    expect((await collectionsState('user')).diagnosticFirst).toBe(true);
    await expect(completeCollectionsBlock('user', 'conceptos')).rejects.toMatchObject({ code: 'EXAM_FIRST' });
    const draft = await startCollectionsExam('user');
    expect(draft).toMatchObject({ sectionIndex: 0, answers: {} });
    const section = EXAM_SECTIONS[1]!; const answers = goodAnswers();
    await expect(saveCollectionsExamSection('user', section.key, Object.fromEntries(section.questions.map((q) => [q.key, answers[q.key]!])))).rejects.toMatchObject({ code: 'PREVIOUS_SECTION_REQUIRED' });
    expect((await collectionsState('user')).exam.attempts).toBe(0);
  });

  it('guarda respuestas erróneas sin corregir, permite retomar y admite un reenvío idéntico', async () => {
    await startCollectionsExam('user');
    const answers = { 'inicio-accion': 'saldo', 'inicio-guion': 'No sé.' };
    const draft = await saveCollectionsExamSection('user', 'inicio', answers);
    expect(draft).toMatchObject({ sectionIndex: 1, answers });
    expect(draft).not.toHaveProperty('result'); expect(draft).not.toHaveProperty('score');
    expect(await startCollectionsExam('user')).toEqual(draft);
    expect(await saveCollectionsExamSection('user', 'inicio', answers)).toEqual(draft);
    await expect(saveCollectionsExamSection('user', 'inicio', { ...answers, 'inicio-accion': 'identificar' })).rejects.toMatchObject({ code: 'PREVIOUS_SECTION_REQUIRED' });
    const state = await collectionsState('user');
    expect(state.exam.draft).toEqual(draft); expect(state.exam.lastResult).toBeNull();
  });

  it('impide calificar un intento incompleto o alterar las respuestas guardadas', async () => {
    await startCollectionsExam('user');
    await expect(submitCollectionsExam('user', goodAnswers())).rejects.toThrow('siete secciones');
    await saveAll(goodAnswers());
    await expect(submitCollectionsExam('user', { ...goodAnswers(), 'inicio-accion': 'ordenar' })).rejects.toThrow('coincidir');
    expect(memory.rows.find((r) => r.blockKey === EXAM_KEY)).toBeUndefined();
  });

  it('guarda el resultado en el historial, registra el intento oficial una vez y abre la teoría', async () => {
    const answers = goodAnswers();
    answers['negociacion-descuento'] = 'aprobar'; // 92 puntos, pero error crítico.
    await saveAll(answers);
    const first = await submitCollectionsExam('user', answers);
    expect(first.result).toMatchObject({ score: 92, passed: false, verdict: 'Requiere refuerzo' });
    expect(first.state.exam.draft).toBeNull();
    expect(first.state.diagnosticFirst).toBe(false);
    expect(first.state.blocks[0]!.enabled).toBe(true);
    expect(memory.rows.find((r) => r.blockKey === 'examen-intento-1').answers).toMatchObject({ version: 2, answers, result: first.result, attemptId: 'attempt-1' });
    const savedCoaching = memory.rows.find((r) => r.blockKey === 'examen-intento-1').answers.coaching;
    expect(savedCoaching.improvements.find((item: any) => item.key === 'negociacion-descuento')).toMatchObject({ priority: 'critical' });
    expect(memory.rows.find((r) => r.blockKey === EXAM_DRAFT_KEY).answers.status).toBe('submitted');
    const retry = await submitCollectionsExam('user', answers);
    expect(retry.result).toEqual(first.result); expect(retry.state.exam.attempts).toBe(1);
    expect(submitAttemptTx).toHaveBeenCalledTimes(1);
    // Un intento: sin autorización no se abre otro.
    await expect(startCollectionsExam('user')).rejects.toMatchObject({ code: 'NO_ATTEMPTS_LEFT' });
    expect(completeModule).not.toHaveBeenCalled();
  });

  it('aprobar el diagnóstico no completa el módulo: lo completa la teoría', async () => {
    await saveAll(goodAnswers());
    const passed = await submitCollectionsExam('user', goodAnswers());
    expect(passed.result.passed).toBe(true);
    expect(passed.state.complete).toBe(false);
    expect(completeModule).not.toHaveBeenCalled();
    for (const key of COLLECTIONS_KEYS) await completeCollectionsBlock('user', key);
    expect(completeModule).toHaveBeenCalledTimes(1);
  });

  it('conserva aprobaciones históricas sin recalificar respuestas del examen anterior', async () => {
    memory.legacy = true;
    memory.availability = { ...memory.availability, passed: true, canStart: false };
    memory.rows.push({ id: EXAM_KEY, blockKey: EXAM_KEY, completedAt: new Date(), attempts: 1, answers: { reporte: 'reportado' } });
    const state = await collectionsState('user');
    expect(state.exam).toMatchObject({ passed: true, lastResult: null, draft: null });
    expect(state.complete).toBe(true);
    expect(state.blocks.every((block) => block.enabled)).toBe(true);
  });

  it('no reutiliza números de intento tras reiniciar el progreso conservando el historial', async () => {
    await saveAll(goodAnswers());
    await submitCollectionsExam('user', goodAnswers());
    const archive = memory.rows.filter((row) => row.blockKey.startsWith('examen-intento-'));
    // Reinicio del curso: se borra el avance pero el historial del examen se conserva; el cupo vuelve a uno.
    memory.rows = [...archive];
    memory.availability = { passed: false, openAttemptId: null, canStart: true, remaining: 1, nextNumber: 1, exhausted: false };
    await saveAll(goodAnswers());
    await submitCollectionsExam('user', goodAnswers());
    expect(memory.rows.filter((row) => row.blockKey.startsWith('examen-intento-')).map((row) => row.blockKey)).toEqual(['examen-intento-1', 'examen-intento-2']);
    expect(memory.rows.find((row) => row.blockKey === 'examen-intento-1')).toEqual(archive[0]);
  });
});
