import { describe, expect, it } from 'vitest';
import { gradeObjectionCase, gradeObjections, OBJECTIONS_CASE_KEYS, OBJECTIONS_OPTIONS_VERSION } from '../domain/objections-expert.js';
import { OBJECTION_OPTIONS, publicOptions } from '../domain/objections-options.js';

describe('módulo 03: elegir la respuesta más óptima', () => {
  it('cada caso tiene cuatro opciones con una sola respuesta de 20 puntos y al menos una de 10', () => {
    for (const key of OBJECTIONS_CASE_KEYS) {
      const options = OBJECTION_OPTIONS[key]!;
      expect(options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(options.filter((o) => o.score === 20)).toHaveLength(1);
      expect(options.filter((o) => o.score === 10).length).toBeGreaterThanOrEqual(1);
      expect(new Set(options.map((o) => o.text)).size).toBe(4);
    }
  });

  it('lo que recibe el navegador no revela el puntaje ni el porqué', () => {
    for (const key of OBJECTIONS_CASE_KEYS) {
      for (const option of publicOptions(key)) expect(Object.keys(option).sort()).toEqual(['id', 'text']);
    }
  });

  it('califica 20, 10 y 0 y marca las acciones de riesgo', () => {
    const best = (key: string) => OBJECTION_OPTIONS[key]!.find((o) => o.score === 20)!.id;
    expect(gradeObjectionCase('sin-dinero', best('sin-dinero'))).toMatchObject({ score: 20, critical: [] });
    const partial = OBJECTION_OPTIONS['ya-pague']!.find((o) => o.score === 10)!;
    expect(gradeObjectionCase('ya-pague', partial.id)).toMatchObject({ score: 10, answer: partial.text });
    const risky = OBJECTION_OPTIONS['salario-pendiente']!.find((o) => o.risk)!;
    const grade = gradeObjectionCase('salario-pendiente', risky.id);
    expect(grade.score).toBe(0);
    expect(grade.critical).toHaveLength(1);
    expect(grade.recommendations[0]).toMatch(/más óptima/);
  });

  it('las cinco mejores aprueban con 100 y tres mejores más dos aceptables aprueban con 80', () => {
    const pick = (score: number) => Object.fromEntries(OBJECTIONS_CASE_KEYS.map((key) => [key, OBJECTION_OPTIONS[key]!.find((o) => o.score === score)!.id]));
    const all = gradeObjections(pick(20));
    expect(all).toMatchObject({ score: 100, passed: true, version: OBJECTIONS_OPTIONS_VERSION });
    const mixed = { ...pick(20), 'no-reconoce': pick(10)['no-reconoce']!, 'ya-pague': pick(10)['ya-pague']! };
    expect(gradeObjections(mixed)).toMatchObject({ score: 80, passed: true });
    const weak = { ...mixed, 'sin-dinero': pick(10)['sin-dinero']! };
    expect(gradeObjections(weak)).toMatchObject({ score: 70, passed: false });
  });
});
