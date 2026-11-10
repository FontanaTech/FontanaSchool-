import { FINAL_EXAM_BANK, FINAL_EXAM_TOPICS, type FinalExamQuestion, type FinalExamTopic } from './final-exam-bank.js';

// Examen general ABCD: reglas puras (sin base de datos) para sortear, mostrar y calificar.
// El servidor guarda qué preguntas le tocaron a cada intento; nunca envía la respuesta correcta mientras el
// intento está abierto.

export const FINAL_EXAM_SLUG = 'examen-general';
export const FINAL_EXAM_NAME = 'Examen general';
export const FINAL_EXAM_ACTIVITY_TITLE = 'Examen general ABCD';
// Propuesta inicial; el administrador la cambia creando otra versión de la evaluación.
export const FINAL_EXAM_DEFAULTS = { questionCount: 20, minimumScore: 80 } as const;
export const FINAL_EXAM_LIMITS = { questionCount: { min: 12, max: FINAL_EXAM_BANK.length }, minimumScore: { min: 50, max: 100 } } as const;
export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];
// Tema con menos de este porcentaje de aciertos: se recomienda repasarlo.
const WEAK_TOPIC_PERCENT = 70;

// Dónde se repasa cada tema (para las recomendaciones del resultado).
export const TOPIC_MODULE: Record<FinalExamTopic, string> = {
  conceptos: 'Inducción a las cobranzas',
  etapas: 'Inducción a las cobranzas',
  tipos: 'Inducción a las cobranzas',
  'titular-datos': 'Inducción a las cobranzas',
  comunicacion: 'Enfréntate a la objeción',
  objeciones: 'Enfréntate a la objeción',
  acuerdos: 'Inducción a las cobranzas',
  registro: 'Tipifica',
  tipificacion: 'Tipifica',
  'control-next': 'Tipifica (clon de Control Next)',
  ofimatica: 'Ofimática para tus cobranzas',
};

const BY_ID = new Map(FINAL_EXAM_BANK.map((question) => [question.id, question]));

export function findQuestion(id: string): FinalExamQuestion | undefined {
  return BY_ID.get(id);
}

// Generador determinista (mulberry32): la misma semilla produce el mismo sorteo.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

// Sorteo equilibrado: se reparte por turnos entre los temas (orden de temas también sorteado), así cada tema
// aporta casi la misma cantidad de preguntas. Las preguntas pendientes de validación no se sortean.
export function pickQuestions(count: number, seed: number, bank: readonly FinalExamQuestion[] = FINAL_EXAM_BANK): string[] {
  const next = random(seed);
  const eligible = bank.filter((question) => !question.needsValidation);
  const pools = new Map<FinalExamTopic, FinalExamQuestion[]>();
  for (const question of shuffle(eligible, next)) pools.set(question.topic, [...(pools.get(question.topic) ?? []), question]);
  const topics = shuffle([...pools.keys()], next);
  const picked: FinalExamQuestion[] = [];
  const target = Math.min(count, eligible.length);
  while (picked.length < target) {
    for (const topic of topics) {
      const question = pools.get(topic)!.shift();
      if (question && picked.length < target) picked.push(question);
    }
  }
  return shuffle(picked, next).map((question) => question.id);
}

export type PublicQuestion = { id: string; topic: FinalExamTopic; topicLabel: string; prompt: string; options: { letter: OptionLetter; text: string }[] };

// Lo que ve el asesor durante el examen: sin respuesta ni explicación.
export function publicQuestion(question: FinalExamQuestion): PublicQuestion {
  return {
    id: question.id, topic: question.topic, topicLabel: FINAL_EXAM_TOPICS[question.topic], prompt: question.prompt,
    options: question.options.map((text, index) => ({ letter: OPTION_LETTERS[index]!, text })),
  };
}

export function isLetter(value: unknown): value is OptionLetter {
  return typeof value === 'string' && (OPTION_LETTERS as readonly string[]).includes(value);
}

export type FinalExamGrade = {
  score: number;
  correct: number;
  total: number;
  minimumScore: number;
  passed: boolean;
  topics: { topic: FinalExamTopic; label: string; correct: number; total: number; percent: number }[];
  review: { id: string; prompt: string; topicLabel: string; selected: OptionLetter | null; selectedText: string | null; correctLetter: OptionLetter; correctText: string; explanation: string }[];
  recommendations: string[];
  answers: { questionId: string; optionId: OptionLetter | null; isCorrect: boolean; awardedScore: number }[];
};

// Calificación sobre 100 con dos decimales. Una pregunta sin responder cuenta como incorrecta.
export function gradeFinalExam(questionIds: string[], answers: Record<string, OptionLetter | null>, minimumScore: number): FinalExamGrade {
  // El banco cambia entre versiones (preguntas retiradas): un intento guardado con una pregunta que ya no existe se
  // califica con las que siguen vigentes en vez de fallar.
  const questions = questionIds.flatMap((id) => {
    const question = findQuestion(id);
    return question ? [question] : [];
  });
  if (!questions.length) throw new Error('El intento no tiene preguntas.');
  const each = 100 / questions.length;
  const rows = questions.map((question) => {
    const selected = answers[question.id] ?? null;
    const isCorrect = selected !== null && OPTION_LETTERS.indexOf(selected) === question.answer;
    return { question, selected, isCorrect };
  });
  const correct = rows.filter((row) => row.isCorrect).length;
  const score = Math.round((correct / questions.length) * 10000) / 100;
  const topics = (Object.keys(FINAL_EXAM_TOPICS) as FinalExamTopic[])
    .map((topic) => {
      const own = rows.filter((row) => row.question.topic === topic);
      const hits = own.filter((row) => row.isCorrect).length;
      return { topic, label: FINAL_EXAM_TOPICS[topic], correct: hits, total: own.length, percent: own.length ? Math.round((hits / own.length) * 100) : 0 };
    })
    .filter((topic) => topic.total > 0);
  const weak = topics.filter((topic) => topic.percent < WEAK_TOPIC_PERCENT);
  const passed = score >= minimumScore;
  const recommendations = weak.length
    ? weak.map((topic) => `Repasa «${topic.label}» en ${TOPIC_MODULE[topic.topic]} (${topic.correct} de ${topic.total} correctas).`)
    : [passed ? 'Mantén tu nivel: repasa los módulos cuando lo necesites.' : 'Repasa las preguntas que fallaste y vuelve a los módulos de la formación.'];
  return {
    score, correct, total: questions.length, minimumScore, passed, topics, recommendations,
    review: rows.filter((row) => !row.isCorrect).map((row) => ({
      id: row.question.id, prompt: row.question.prompt, topicLabel: FINAL_EXAM_TOPICS[row.question.topic],
      selected: row.selected, selectedText: row.selected ? row.question.options[OPTION_LETTERS.indexOf(row.selected)]! : null,
      correctLetter: OPTION_LETTERS[row.question.answer]!, correctText: row.question.options[row.question.answer], explanation: row.question.explanation,
    })),
    answers: rows.map((row) => ({ questionId: row.question.id, optionId: row.selected, isCorrect: row.isCorrect, awardedScore: row.isCorrect ? Math.round(each * 100) / 100 : 0 })),
  };
}
