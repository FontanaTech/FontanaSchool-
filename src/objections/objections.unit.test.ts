import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gradeObjections, OBJECTIONS_CASES } from '../../server/domain/objections-expert';
import { OBJECTION_OPTIONS, publicOptions } from '../../server/domain/objections-options';
const mocks = vi.hoisted(() => ({ api: vi.fn(), saving: vi.fn(), confirm: vi.fn(), close: vi.fn() }));
vi.mock('../http', async original => ({ ...await original<any>(), api: mocks.api }));
vi.mock('../seal-animation', async original => ({ ...await original<any>(), playSeal: vi.fn() }));
vi.mock('../reactivation', () => ({ bindReactivation: vi.fn(), reactivationNotice: () => '' }));
vi.mock('../office/excel-saving-dialog', () => ({ showExcelSavingDialog: mocks.saving }));
import { mountObjections } from './objections';
import { playSeal } from '../seal-animation';
import { caseSlideCopy } from './case-visuals';

// Superficie mínima del componente para verificar montaje, restauración y eventos del editor.
// No sustituye la revisión visual ni simula un navegador completo.
class ElementStub {
  disabled = false; hidden = false; textContent = ''; value = ''; isConnected = true;
  listeners = new Map<string, () => void>();
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn); }
  removeEventListener() { /* sin navegador */ }
  focus() { /* sin navegador */ }
}
class ContainerStub extends ElementStub {
  html = '';
  elements = new Map<string, ElementStub>();
  options: ElementStub[] = [];
  set innerHTML(value: string) {
    this.html = value; this.elements.clear();
    for (const [selector, marker] of [['#obx-title', 'id="obx-title"'], ['#obx-answer', 'name="obx-option"'], ['[data-save-error]', 'data-save-error'], ['[data-intro-next]', 'data-intro-next'], ['[data-intro-prev]', 'data-intro-prev'], ['[data-answer-next]', 'data-answer-next'], ['[data-start]', 'data-start']]) {
      if (value.includes(marker!)) this.elements.set(selector!, new ElementStub());
    }
    this.options = [...value.matchAll(/<input type="radio" name="obx-option" value="(\w)"/g)].map(match => { const option = new ElementStub(); option.value = match[1]!; return option; });
  }
  get innerHTML() { return this.html; }
  querySelector(selector: string) { return this.elements.get(selector) ?? null; }
  querySelectorAll(selector: string) { return selector === 'input[name="obx-option"]' ? this.options : []; }
}
function fixture(draft: boolean) {
  return { name: 'Enfréntate a la objeción', complete: false, reviewMode: false, legacyCompleted: false,
    percent: draft ? 50 : 0, completedCount: 0, currentBlock: OBJECTIONS_CASES[0].key,
    cases: OBJECTIONS_CASES.map(c => ({ ...c, options: publicOptions(c.key) })), blocks: OBJECTIONS_CASES.map(c => ({ key: c.key, completed: false, enabled: true })),
    nextRoute: null, nextName: 'Tipifica', exam: { activityId: 'activity', minimumScore: 80, maxAttempts: 1,
      enabled: true, canStart: !draft, status: draft ? 'EN_PROGRESO' : 'PENDIENTE', reactivationRequestedAt: null, result: null,
      draft: draft ? { attemptId: 'attempt', number: 1, answers: { 'sin-dinero': 'c' } } : null } };
}
const choose = (root: ContainerStub, id: string) => root.options.find(option => option.value === id)!.listeners.get('change')!();

describe('montaje y borrador de la evaluación de objeciones', () => {
  let root: ContainerStub;
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers();
    mocks.saving.mockReturnValue({ confirm: mocks.confirm, close: mocks.close });
    mocks.confirm.mockResolvedValue(undefined);
    root = new ContainerStub();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('abre directamente la tarjeta de introducción con sus flechas', async () => {
    mocks.api.mockResolvedValue({ data: fixture(false) });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    expect(root.innerHTML).toContain('No tengo dinero');
    expect(root.innerHTML).toContain('Caso 1 de 5');
    expect(root.innerHTML).toContain('<p class="obx-example-visible"><b>Ejemplo:</b>');
    expect(root.innerHTML).toContain(caseSlideCopy('sin-dinero').example);
    expect(root.innerHTML).not.toContain('Ver un ejemplo de enfoque');
    expect(root.innerHTML).not.toContain('No pudimos abrir el módulo');
  });
  it('abre directamente un borrador recuperado, sin errores de inicialización', async () => {
    mocks.api.mockResolvedValue({ data: fixture(true) });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    expect(root.innerHTML).not.toContain('No pudimos abrir el módulo');
    expect(root.options).toHaveLength(4);
    expect(root.innerHTML).toContain('value="c" checked');
    expect(root.innerHTML).toContain('Elige la respuesta más óptima para este caso');
    expect(root.innerHTML).not.toContain('Borrador guardado');
    expect(root.innerHTML).not.toContain('data-text-count');
    expect(root.innerHTML).not.toContain('data-answer-prev');
    expect(root.innerHTML).not.toContain('>Guardar borrador<');
  });
  it('recorre los cinco sliders y vuelve atrás sin guardar lecturas ni llamar al servidor', async () => {
    mocks.api.mockResolvedValue({ data: fixture(false) });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    expect(root.innerHTML).not.toContain('Lo entendí');
    root.querySelector('[data-intro-next]')!.listeners.get('click')!();
    expect(root.innerHTML).toContain('Caso 2 de 5');
    root.querySelector('[data-intro-prev]')!.listeners.get('click')!();
    expect(root.innerHTML).toContain('Caso 1 de 5');
    for (let i = 0; i < 5; i++) root.querySelector('[data-intro-next]')!.listeners.get('click')!();
    expect(root.innerHTML).toContain('Elige la respuesta más óptima');
    expect(root.innerHTML).not.toContain('casos revisados');
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith('/training/objections/module');
  });
  it('conserva la opción elegida en memoria sin llamar al servidor hasta el envío', async () => {
    mocks.api.mockResolvedValue({ data: fixture(true) });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    choose(root, 'a');
    await vi.advanceTimersByTimeAsync(1200);
    // Las respuestas viven solo en pantalla: escribir no dispara ningún guardado en el servidor.
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith('/training/objections/module');
    expect(root.querySelector('[data-save-error]')).toBeNull();
  });
  it('muestra la carga al comenzar, evita doble inicio y abre el editor solo tras la respuesta del servidor', async () => {
    let acknowledge!: (value: unknown) => void;
    mocks.api.mockResolvedValueOnce({ data: fixture(false) }).mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    for (let i = 0; i < 5; i++) root.querySelector('[data-intro-next]')!.listeners.get('click')!();
    const start = root.querySelector('[data-start]')!;
    start.listeners.get('click')!(); start.listeners.get('click')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.saving).toHaveBeenCalledWith(root, 'tus cinco casos', { mode: 'start' });
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(root.querySelector('#obx-answer')).toBeNull();
    const opened = fixture(true); opened.exam.draft!.answers['sin-dinero'] = '';
    acknowledge({ data: opened });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(1); expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toContain('EVALUACIÓN · CASO 1 DE 5');
  });
  it('cierra la carga y permite reintentar si no se puede iniciar la evaluación', async () => {
    mocks.api.mockResolvedValueOnce({ data: fixture(false) }).mockRejectedValue(new Error('No se pudo iniciar'));
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    for (let i = 0; i < 5; i++) root.querySelector('[data-intro-next]')!.listeners.get('click')!();
    root.querySelector('[data-start]')!.listeners.get('click')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toContain('No se pudo iniciar');
    expect(root.querySelector('[data-start]')).not.toBeNull();
    expect(root.querySelector('#obx-answer')).toBeNull();
  });
  it('al elegir una opción no guarda en el servidor ni muestra error aunque la red esté caída', async () => {
    mocks.api.mockResolvedValueOnce({ data: fixture(true) }).mockRejectedValue(new Error('Sin conexión'));
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    choose(root, 'b');
    await vi.advanceTimersByTimeAsync(1200);
    // Como no hay guardado por tecla, una red caída no afecta lo escrito ni genera un error de guardado.
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-save-error]')).toBeNull();
  });
  it('al elegir y continuar pasa al siguiente caso sin diálogo de guardado', async () => {
    mocks.api.mockResolvedValue({ data: fixture(true) });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    choose(root, 'c');
    root.querySelector('[data-answer-next]')!.listeners.get('click')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.saving).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(root.innerHTML).toContain('EVALUACIÓN · CASO 2 DE 5');
  });
  it('continuar no llama al servidor: una red caída no borra la respuesta ni bloquea el avance', async () => {
    mocks.api.mockResolvedValueOnce({ data: fixture(true) }).mockRejectedValue(new Error('No se pudo guardar'));
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    choose(root, 'c');
    root.querySelector('[data-answer-next]')!.listeners.get('click')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.saving).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(root.innerHTML).toContain('EVALUACIÓN · CASO 2 DE 5');
  });
  it('restaura el sello y la nota real de 80 sin repetir la celebración ni exigir cinco casos perfectos', async () => {
    const best = (key: string) => OBJECTION_OPTIONS[key]!.find(o => o.score === 20)!.id;
    const worst = (key: string) => OBJECTION_OPTIONS[key]!.find(o => o.score === 0)!.id;
    const answers = { ...Object.fromEntries(OBJECTIONS_CASES.map(c => [c.key, best(c.key)])), 'sin-dinero': worst('sin-dinero') };
    const state = { ...fixture(false), complete: true, nextRoute: '#tipifica', exam: { ...fixture(false).exam,
      result: gradeObjections(answers) } };
    mocks.api.mockResolvedValue({ data: state });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    // El resultado aprobado muestra el sello y la nota, sin desglosar los criterios por caso.
    expect(root.innerHTML).not.toContain('class="obx-checks"');
    expect(root.innerHTML).not.toContain('/4');
    expect(root.innerHTML).toContain('Sello obtenido: módulo 03');
    expect(root.innerHTML).toContain('id="objections-result-wine"');
    expect(root.innerHTML).toContain('¡Obtuviste tu sello!');
    expect(root.innerHTML).toContain('class="obx-total">80');
    expect(root.innerHTML).toContain('href="#tipifica"');
    expect(playSeal).not.toHaveBeenCalled();
  });
  it('un resultado no aprobado conserva el refuerzo y no muestra el sello de éxito', async () => {
    const result = gradeObjections(Object.fromEntries(OBJECTIONS_CASES.map(c => [c.key, OBJECTION_OPTIONS[c.key]!.find(o => o.score === 0)!.id])));
    mocks.api.mockResolvedValue({ data: { ...fixture(false), exam: { ...fixture(false).exam, result } } });
    await mountObjections(root as unknown as HTMLElement, '#ruta');
    expect(root.innerHTML).toContain('Vamos a reforzar tu gestión');
    expect(root.innerHTML).not.toContain('Sello obtenido: módulo 03');
    expect(root.innerHTML).not.toContain('¡Obtuviste tu sello!');
  });
});
