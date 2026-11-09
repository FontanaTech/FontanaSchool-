import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(), report: vi.fn(), override: vi.fn(), audit: vi.fn(), certified: vi.fn(),
  tx: { $queryRaw: vi.fn(), usuario: { findUnique: vi.fn() }, userActivityOverride: { findUnique: vi.fn() }, reactivationRequest: { findFirst: vi.fn() } },
}));
vi.mock('../config/prisma.js', () => ({ prisma: { $transaction: (fn: any) => fn(mocks.tx) } }));
vi.mock('../services/progress.service.js', () => ({ loadSnapshot: mocks.snapshot }));
vi.mock('../services/retry-report.service.js', () => ({ retryReport: mocks.report }));
vi.mock('../services/override.service.js', () => ({ createOverrideTx: mocks.override }));
vi.mock('../services/audit.service.js', () => ({ audit: mocks.audit }));
vi.mock('../services/attempt.service.js', () => ({ assertNotCertified: mocks.certified }));
import { activateSelfRetry, evaluationRetryState } from '../services/evaluation-retry.service.js';
import { initialEvaluation, selfRetryKey } from '../domain/evaluation-retry.js';

describe('único reintento solicitado por el asesor', () => {
  let snapshot: any;
  const state = () => evaluationRetryState('advisor', 'activity', mocks.tx as any);
  beforeEach(() => {
    vi.resetAllMocks();
    snapshot = { activeCertificateId: null, modules: [{ id: 'module', activities: [{ id: 'activity', status: 'ACTIVE' }] }],
      views: [{ moduleId: 'module', enabled: true }], evaluations: new Map([['activity', {}]]),
      availability: new Map([['activity', { exhausted: true, passed: false, remaining: 0 }]]) };
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.tx.usuario.findUnique.mockResolvedValue({ rol: 'asesor', estado: 'activo', debeCompletarDatos: false });
    mocks.tx.userActivityOverride.findUnique.mockResolvedValue(null);
    mocks.tx.reactivationRequest.findFirst.mockResolvedValue(null);
    mocks.report.mockResolvedValue({ attemptId: 'failed-attempt', recommendations: [] });
    mocks.override.mockResolvedValue({ id: 'grant' });
  });
  it('el primer fallo ofrece reintento sin crear solicitudes ni alterar otros módulos', async () => {
    expect(await state()).toMatchObject({ phase: 'SELF_RETRY_AVAILABLE', selfRetryUsed: false });
    expect(await activateSelfRetry('advisor', 'activity')).toMatchObject({ activated: true });
    expect(mocks.override).toHaveBeenCalledWith(mocks.tx, 'advisor', 'activity', expect.objectContaining({ extraAttempts: 1, action: 'REACTIVATE' }), selfRetryKey('advisor', 'activity'), { actorUserId: 'advisor' }, expect.any(Date));
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, { actorUserId: 'advisor' }, expect.objectContaining({ action: 'SELF_RETRY_ACTIVATED' }));
  });
  it('repetir la petición o recargar no concede un tercer intento', async () => {
    mocks.tx.userActivityOverride.findUnique.mockResolvedValue({ id: 'grant', consumedAt: new Date() });
    expect(await activateSelfRetry('advisor', 'activity')).toMatchObject({ activated: false, alreadyActivated: true });
    expect((await state()).phase).toBe('SUPPORT_REQUIRED');
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('el reintento habilitado no se confunde con un segundo fallo', async () => {
    mocks.tx.userActivityOverride.findUnique.mockResolvedValue({ id: 'grant' });
    snapshot.availability.set('activity', { remaining: 1 });
    expect((await state()).phase).toBe('RETRY_READY');
  });
  it('si aprobó desde otra pestaña no vuelve a generar una constancia de fallo', async () => {
    snapshot.availability.set('activity', { passed: true });
    expect(await state()).toMatchObject({ phase: 'PASSED', report: null });
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('muestra la espera de acompañamiento y bloquea activaciones durante ella', async () => {
    mocks.tx.reactivationRequest.findFirst.mockResolvedValue({ id: 'pending', status: 'PENDING' });
    expect((await state()).phase).toBe('SUPPORT_PENDING');
    await expect(activateSelfRetry('advisor', 'activity')).rejects.toMatchObject({ code: 'SUPPORT_PENDING' });
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it.each([{ passed: true, remaining: 0 }, { remaining: 1 }, { openAttemptId: 'open' }])('no concede cupos a una prueba aprobada o disponible: %o', async availability => {
    snapshot.availability.set('activity', availability);
    await expect(activateSelfRetry('advisor', 'activity')).rejects.toMatchObject({ code: 'SELF_RETRY_NOT_NEEDED' });
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('exige un resultado fallido real antes de conceder el cupo', async () => {
    mocks.report.mockRejectedValue(new Error('Sin resultado fallido'));
    await expect(activateSelfRetry('advisor', 'activity')).rejects.toThrow('Sin resultado fallido');
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('impide reintentos en módulos bloqueados, de otro perfil o a certificados', async () => {
    snapshot.views[0].enabled = false;
    await expect(activateSelfRetry('advisor', 'activity')).rejects.toMatchObject({ code: 'MODULE_BLOCKED' });
    snapshot.views[0].enabled = true;
    mocks.tx.usuario.findUnique.mockResolvedValue({ rol: 'administrador', estado: 'activo' });
    await expect(activateSelfRetry('advisor', 'activity')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mocks.certified.mockRejectedValue(new Error('Certificado activo'));
    await expect(activateSelfRetry('advisor', 'activity')).rejects.toThrow('Certificado activo');
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('el cupo base sale de la evaluación vigente (se cambia en Módulos y actividades) y nunca agrega esperas', () => {
    expect(initialEvaluation({ maxAttempts: 3, waitMinutes: 30, minimumScore: 80 })).toEqual({ maxAttempts: 3, waitMinutes: 0, minimumScore: 80 });
    expect(initialEvaluation({ maxAttempts: 0, waitMinutes: 0, minimumScore: 80 })).toMatchObject({ maxAttempts: 1 });
  });
  it('el cupo individual del asesor manda sobre el de la evaluación', () => {
    expect(initialEvaluation({ maxAttempts: 1, waitMinutes: 0 }, 4)).toMatchObject({ maxAttempts: 4 });
    expect(initialEvaluation({ maxAttempts: 3, waitMinutes: 0 }, 1)).toMatchObject({ maxAttempts: 1 });
    expect(initialEvaluation({ maxAttempts: 2, waitMinutes: 0 }, null)).toMatchObject({ maxAttempts: 2 });
  });
  it('conserva el motivo de rechazo para el aviso de acompañamiento', async () => {
    mocks.tx.userActivityOverride.findUnique.mockResolvedValue({ id: 'grant' });
    mocks.tx.reactivationRequest.findFirst.mockResolvedValue({ id: 'rejected', status: 'REJECTED', decisionReason: 'Repasa primero los casos.' });
    expect(await state()).toMatchObject({ phase: 'SUPPORT_REQUIRED', rejectionReason: 'Repasa primero los casos.', requestId: null });
  });
});
