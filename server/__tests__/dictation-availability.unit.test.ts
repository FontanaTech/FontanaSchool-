import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Sin la voz de prueba del navegador (el .env de desarrollo puede activarla): se comprueba el audio real.
vi.hoisted(() => { process.env.DICTATION_DEV_TTS = 'false'; });

import { LocalDiskStorage, setStorageForTests } from '../integrations/storage.js';
import { nextExercise } from '../services/office-dictation.service.js';

// El dictado solo se ofrece con un audio que ESTE equipo puede reproducir. Caso real (2026-11-11): la base seguía
// apuntando a dos audios que se borraron del repositorio y los equipos actualizados mostraban
// «Este ejercicio todavía no tiene audio autorizado».

const folder = mkdtempSync(path.join(tmpdir(), 'fontana-dictado-'));
setStorageForTests(new LocalDiskStorage(folder));
afterAll(() => { setStorageForTests(null); rmSync(folder, { recursive: true, force: true }); });

const exercise = (key: string, audioKey: string | null) => ({
  id: `id-${key}`, key, version: 1, status: 'ACTIVE', title: key, expectedText: `Texto de ${key}.`, difficulty: 1, audioKey, audioDurationSeconds: 24,
});
const conAudio = exercise('dictado-con-audio', 'dictado-con-audio-v1.mp3');
const otroConAudio = exercise('dictado-otro', 'dictado-otro-v1.mp3');
const sinArchivo = exercise('dictado-sin-archivo', 'dictado-sin-archivo-v1.mp3');
const sinClave = exercise('dictado-sin-clave', null);
writeFileSync(path.join(folder, conAudio.audioKey!), Buffer.from('ID3 audio de prueba'));
writeFileSync(path.join(folder, otroConAudio.audioKey!), Buffer.from('ID3 audio de prueba'));

type Open = { attemptId: string; exerciseId: string; playsUsed: number; exercise: ReturnType<typeof exercise> } | null;

function fakeDb(state: { exercises: ReturnType<typeof exercise>[]; open: Open; used?: string[]; lostRace?: Open }) {
  return {
    dictationExercise: { findMany: vi.fn(async () => state.exercises) },
    dictationAttemptResult: {
      findFirst: vi.fn(async () => state.open),
      findMany: vi.fn(async () => (state.used ?? []).map((key) => ({ exercise: { key } }))),
      updateMany: vi.fn(async ({ where }: { where: { attemptId: string; exerciseId: string; playsUsed: number } }) => {
        if (state.lostRace) return { count: 0 };
        return { count: state.open && state.open.exerciseId === where.exerciseId && state.open.playsUsed === where.playsUsed ? 1 : 0 };
      }),
      findUnique: vi.fn(async () => state.lostRace ?? state.open),
    },
  };
}
const next = (db: ReturnType<typeof fakeDb>) => nextExercise('asesor', db as never, 'actividad-dictado');

describe('dictado: solo ejercicios con audio en este equipo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nunca ofrece un ejercicio cuyo archivo de audio no está en el equipo ni uno sin audio', async () => {
    const db = fakeDb({ exercises: [conAudio, sinArchivo, sinClave], open: null });
    for (let i = 0; i < 25; i += 1) expect((await next(db))?.exercise.key).toBe(conAudio.key);
  });

  it('si ningún ejercicio tiene su audio aquí, no hay dictado (en vez de fallar al reproducir)', async () => {
    expect(await next(fakeDb({ exercises: [sinArchivo, sinClave], open: null }))).toBeNull();
  });

  it('prefiere un ejercicio que el asesor no ha hecho', async () => {
    const db = fakeDb({ exercises: [conAudio, otroConAudio], open: null, used: [conAudio.key] });
    for (let i = 0; i < 10; i += 1) expect((await next(db))?.exercise.key).toBe(otroConAudio.key);
  });

  it('un intento abierto sin audio y sin reproducir se cambia por uno que suena, sin tocar el intento', async () => {
    const db = fakeDb({ exercises: [conAudio, sinArchivo], open: { attemptId: 'intento-1', exerciseId: sinArchivo.id, playsUsed: 0, exercise: sinArchivo } });
    const result = await next(db);
    expect(result).toEqual({ exercise: conAudio, attemptId: 'intento-1' });
    expect(db.dictationAttemptResult.updateMany).toHaveBeenCalledWith({
      where: { attemptId: 'intento-1', exerciseId: sinArchivo.id, playsUsed: 0 },
      data: { exerciseId: conAudio.id, exerciseVersion: conAudio.version, expectedText: conAudio.expectedText },
    });
  });

  it('si otra petición ya lo cambió, devuelve el ejercicio guardado (no dos cambios distintos)', async () => {
    const winner = { attemptId: 'intento-1', exerciseId: otroConAudio.id, playsUsed: 0, exercise: otroConAudio };
    const db = fakeDb({ exercises: [conAudio], open: { attemptId: 'intento-1', exerciseId: sinArchivo.id, playsUsed: 0, exercise: sinArchivo }, lostRace: winner });
    expect(await next(db)).toEqual({ exercise: otroConAudio, attemptId: 'intento-1' });
  });

  it('un intento ya reproducido o con su audio presente no se toca', async () => {
    const played = fakeDb({ exercises: [conAudio], open: { attemptId: 'intento-2', exerciseId: sinArchivo.id, playsUsed: 1, exercise: sinArchivo } });
    expect((await next(played))?.exercise.key).toBe(sinArchivo.key);
    const fine = fakeDb({ exercises: [conAudio, otroConAudio], open: { attemptId: 'intento-3', exerciseId: otroConAudio.id, playsUsed: 0, exercise: otroConAudio } });
    expect((await next(fine))?.exercise.key).toBe(otroConAudio.key);
    expect(played.dictationAttemptResult.updateMany).not.toHaveBeenCalled();
    expect(fine.dictationAttemptResult.updateMany).not.toHaveBeenCalled();
  });
});
