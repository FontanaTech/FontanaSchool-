import { describe, expect, it } from 'vitest';
import { buildOpportunities, summarize } from '../domain/performance-report.js';

const base = { finalExam: null, tipifica: [], objections: null, modules: [] };

describe('sistema experto de oportunidades de mejora', () => {
  it('sin resultados no inventa oportunidades', () => {
    expect(buildOpportunities(base)).toEqual([]);
    expect(summarize([])).toMatch(/Sin oportunidades/);
  });

  it('el examen final reprobado y los temas débiles se priorizan', () => {
    const list = buildOpportunities({ ...base, finalExam: { score: 50, minimumScore: 80, passed: false, topics: [
      { label: 'Manejo de objeciones', correct: 1, total: 4, percent: 25, module: 'Enfréntate a la objeción' },
      { label: 'Tipos de cobranza', correct: 3, total: 4, percent: 75, module: 'Inducción a las cobranzas' },
      { label: 'Registro de la gestión', correct: 2, total: 4, percent: 50, module: 'Tipifica' },
    ] } });
    expect(list.map((item) => item.severity)).toEqual(['alta', 'alta', 'media']);
    expect(list.some((item) => item.finding.includes('Tipos de cobranza'))).toBe(false);
  });

  it('un punto de Tipifica fallado en dos ejercicios es de prioridad alta y trae su consejo', () => {
    const failed = (id: string) => [{ id, label: 'Motivo No Pago acorde a lo que se dijo', detail: 'El cliente dijo estar ocupado.' }];
    const list = buildOpportunities({ ...base, tipifica: [
      { number: 1, title: 'A', met: 9, unmet: 1, failed: failed('motivo') },
      { number: 3, title: 'B', met: 9, unmet: 1, failed: failed('motivo') },
      { number: 4, title: 'C', met: 9, unmet: 1, failed: failed('canal') },
    ] });
    expect(list[0]).toMatchObject({ area: 'Tipifica', severity: 'alta' });
    expect(list[0]!.finding).toContain('ejercicios 1 y 3');
    expect(list[0]!.recommendation).toMatch(/motivo de no pago/i);
    expect(list[1]!.severity).toBe('media');
  });

  it('un módulo sin intentos pide revisar con el asesor y reactivar', () => {
    const list = buildOpportunities({ ...base, modules: [{ name: 'Tipifica', status: 'FAILED', percent: 0 }, { name: 'Otro', status: 'PASSED', percent: 100 }] });
    expect(list).toHaveLength(1);
    expect(list[0]!.recommendation).toMatch(/reactivar/);
  });
});
