import { describe, expect, it } from 'vitest';
import { advanceGuidedCase, answerAlternativePractice, createGuidedCaseState, REGISTRATION_PRACTICE, caseInformation, GUIDED_BLOCKS, type GuidedBlockKey } from '../../src/collections/guided-case-model.js';

describe('Caso de Camila repartido entre los bloques 02 a 05', () => {
  it('mantiene los errores en el paso actual y terminar preparación no completa los otros bloques', () => {
    const state = createGuidedCaseState();
    state.balance = '480000';
    expect(advanceGuidedCase(state, 'preparacion')).not.toBe('');
    state.sourceOpen = true;
    expect(advanceGuidedCase(state, 'preparacion')).not.toBe('');
    expect(state.progress.preparacion.index).toBe(0);
    state.balance = '$400.000';
    expect(advanceGuidedCase(state, 'preparacion')).toBe('');
    expect(state.progress.preparacion.finished).toBe(true);
    for (const block of ['contacto', 'alternativas', 'seguimiento'] as const) {
      expect(state.progress[block]).toEqual({ index: 0, finished: false });
    }
  });

  it('permite recorrer los cuatro bloques con sus propias actividades, sin duplicar ni reiniciar avances', () => {
    const state = createGuidedCaseState();
    Object.assign(state, {
      sourceOpen: true, balance: '400000', holder: 'Camila Rojas', advisor: 'Patricia', portfolio: 'Marketing Personal',
      qualityAnswer: 'calidad', informationPractice: true, informationPortfolio: 'Marketing Personal', informationBalance: '$400.000', informationQuestion: 'posibilidad',
      alternativePractice: { index: 4, answers: ['total', 'abono', 'descuento', 'fecha-total'] },
    });
    for (const block of Object.keys(GUIDED_BLOCKS) as GuidedBlockKey[]) {
      for (const _step of GUIDED_BLOCKS[block].steps) {
        if (block === 'seguimiento') state.registrationAnswer = REGISTRATION_PRACTICE[state.progress.seguimiento.index].expected;
        expect(advanceGuidedCase(state, block)).toBe('');
      }
      expect(state.progress[block]).toEqual({ index: GUIDED_BLOCKS[block].steps.length, finished: true });
      const completed = structuredClone(state.progress);
      expect(advanceGuidedCase(state, block)).toBe('');
      expect(state.progress).toEqual(completed);
    }
    expect(state.registrationAnswers).toEqual(['paz-salvo', 'acuerdo-total', 'acuerdo-abono', 'volver-llamar', 'incumplido', 'sin-acuerdo']);
  });

  it('exige comprender el aviso de calidad antes de pasar a informar y escuchar', () => {
    const state = createGuidedCaseState();
    state.progress.contacto.index = 2;
    state.qualityAnswer = 'pago';
    expect(advanceGuidedCase(state, 'contacto')).toContain('no confirman un pago');
    expect(state.progress.contacto.index).toBe(2);
    state.qualityAnswer = 'calidad';
    expect(advanceGuidedCase(state, 'contacto')).toBe('');
    expect(state.progress.contacto).toEqual({ index: 3, finished: false });
  });

  it('practica cartera, saldo vigente y pregunta antes de completar el contacto', () => {
    const state = createGuidedCaseState();
    state.progress.contacto.index = 3;
    expect(advanceGuidedCase(state, 'contacto')).toContain('Practicar sin mirar');
    state.informationPractice = true;
    state.informationPortfolio = 'Otra cartera';
    state.informationBalance = '$480.000';
    state.informationQuestion = 'descuento';
    expect(advanceGuidedCase(state, 'contacto')).toContain('MARKETING PERSONAL');
    state.informationPortfolio = '  marketing personal  ';
    expect(advanceGuidedCase(state, 'contacto')).toContain('$400.000');
    state.informationBalance = '400000';
    expect(advanceGuidedCase(state, 'contacto')).toContain('sin autorización');
    expect(state.progress.contacto).toEqual({ index: 3, finished: false });
    state.informationQuestion = 'posibilidad';
    expect(advanceGuidedCase(state, 'contacto')).toBe('');
    expect(state.progress.contacto.finished).toBe(true);
    expect(state.progress.alternativas.finished).toBe(false);
    expect(caseInformation()).toBe('Señora Camila, su saldo pendiente con MARKETING PERSONAL es de $400.000. ¿Qué posibilidad de pago tiene en este momento?');
  });

  it('afianza las cuatro posibilidades con reintentos y separa los mini casos de la gestión de Camila', () => {
    const state = createGuidedCaseState();
    expect(advanceGuidedCase(state, 'alternativas')).toContain('cuatro casos');
    expect(answerAlternativePractice(state, 'abono')).toContain('pago total');
    expect(state.alternativePractice).toEqual({ index: 0, answers: [] });
    expect(answerAlternativePractice(state, 'total')).toBe('');
    expect(answerAlternativePractice(state, 'total')).toContain('saldo restante');
    expect(state.alternativePractice.index).toBe(1);
    expect(answerAlternativePractice(state, 'abono')).toBe('');
    expect(advanceGuidedCase(state, 'alternativas')).toContain('cuatro casos');
    expect(answerAlternativePractice(state, 'abono')).toContain('tu líder');
    expect(state.alternativePractice.index).toBe(2);
    expect(answerAlternativePractice(state, 'descuento')).toBe('');
    expect(state.alternativePractice.answers).toEqual(['total', 'abono', 'descuento']);
    expect(advanceGuidedCase(state, 'alternativas')).toContain('cuatro casos');
    expect(answerAlternativePractice(state, 'total')).toContain('fecha futura');
    expect(state.alternativePractice.index).toBe(3);
    expect(answerAlternativePractice(state, 'fecha-total')).toBe('');
    expect(state.alternativePractice.answers).toEqual(['total', 'abono', 'descuento', 'fecha-total']);
    expect(advanceGuidedCase(state, 'alternativas')).toBe('');
    expect(state.progress.alternativas).toEqual({ index: 1, finished: true });
    expect(state.progress.seguimiento.finished).toBe(false);
    expect(state.registrationAnswers).toEqual([]);
    // Repetir el envío tras los siete casos no genera respuestas adicionales.
    expect(answerAlternativePractice(state, 'fecha-total')).toBe('');
    expect(state.alternativePractice.answers).toHaveLength(4);
  });

  it('requires all four cases in order, keeps errors on the current case, and resets each selection', () => {
    const state = createGuidedCaseState();
    expect(advanceGuidedCase(state, 'seguimiento')).not.toBe('');
    expect(state.progress.seguimiento).toEqual({ index: 0, finished: false });
    state.registrationAnswer = 'acuerdo-total';
    expect(advanceGuidedCase(state, 'seguimiento')).toBe(REGISTRATION_PRACTICE[0].feedback);
    expect(state.registrationAnswers).toEqual([]);
    expect(state.registrationAnswer).toBe('acuerdo-total');
    for (const [index, exercise] of REGISTRATION_PRACTICE.entries()) {
      expect(state.progress.seguimiento.index).toBe(index);
      state.registrationAnswer = exercise.expected;
      expect(advanceGuidedCase(state, 'seguimiento')).toBe('');
      expect(state.registrationAnswers).toEqual(REGISTRATION_PRACTICE.slice(0, index + 1).map((item) => item.expected));
      expect(state.registrationAnswer).toBe('');
      expect(state.progress.seguimiento.finished).toBe(index === 5);
      if (index < 5) {
        expect(advanceGuidedCase(state, 'seguimiento')).not.toBe('');
        expect(state.progress.seguimiento.index).toBe(index + 1);
      }
    }
    const completed = structuredClone(state);
    expect(advanceGuidedCase(state, 'seguimiento')).toBe('');
    expect(state).toEqual(completed);
    expect(state.progress.contacto.index).toBe(0);
  });

  it.each(REGISTRATION_PRACTICE.map((exercise, index) => ({ ...exercise, index })))('rejects every wrong option for case $index', (exercise) => {
    const state = createGuidedCaseState();
    for (let index = 0; index < exercise.index; index++) {
      state.registrationAnswer = REGISTRATION_PRACTICE[index].expected;
      expect(advanceGuidedCase(state, 'seguimiento')).toBe('');
    }
    for (const answer of [...REGISTRATION_PRACTICE.map((item) => item.expected), 'invalid']) {
      if (answer === exercise.expected) continue;
      state.registrationAnswer = answer;
      const before = structuredClone(state);
      expect(advanceGuidedCase(state, 'seguimiento')).not.toBe('');
      expect(state).toEqual(before);
    }
    state.registrationAnswer = exercise.expected;
    expect(advanceGuidedCase(state, 'seguimiento')).toBe('');
    expect(state.progress.seguimiento.index).toBe(exercise.index + 1);
  });
});
