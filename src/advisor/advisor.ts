import './advisor.css';
import { api, ApiError, escapar, formatDate } from '../http';
import { revealApp, showAppLoading } from '../loading';
import { progressGuide } from '../progress-guide';
import { pasoEquipoDisponible, TEAM_WELCOME_ROUTE } from '../learning-path';

// Área del asesor: ruta de formación, progreso y acceso a los módulos de contenido.

export type ModuleView = {
  moduleId: string;
  slug: string;
  name: string;
  order: number;
  status: 'NOT_STARTED' | 'AVAILABLE' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'BLOCKED';
  progressPercent: string;
  actionLabel: string;
  route: string;
  enabled: boolean;
  blockedReason: string | null;
  waitUntil: string | null;
  missingSeals?: string[];
};

const STATUS_LABEL: Record<ModuleView['status'], string> = {
  NOT_STARTED: 'Sin iniciar',
  AVAILABLE: 'Disponible',
  IN_PROGRESS: 'En curso',
  PASSED: 'Completado',
  FAILED: 'Sin intentos',
  BLOCKED: 'Bloqueado',
};

function statusLabel(module: ModuleView): string {
  if (module.actionLabel === 'No disponible') return 'No disponible';
  if (module.actionLabel === 'Repasar') return 'Aprobado · modo repaso';
  if (module.slug === 'certificado' && module.status === 'IN_PROGRESS') return 'En validación';
  return STATUS_LABEL[module.status];
}

type CertificationSummary = { status: 'EN_FORMACION' | 'PENDIENTE_VALIDACION' | 'DEVUELTO' | 'CERTIFICADO'; statusLabel: string; reason: string | null };

// Estado general de la certificación encima de los módulos.
function certificationBanner(certification: CertificationSummary | null): string {
  if (!certification || certification.status === 'EN_FORMACION') return '';
  const text = {
    CERTIFICADO: '¡Estás certificado! Todos los módulos quedan abiertos en modo repaso: practica cuanto quieras sin cambiar tus resultados oficiales.',
    PENDIENTE_VALIDACION: 'Completaste la formación y tus evaluaciones. El administrador está validando tu certificación.',
    DEVUELTO: `Tu certificación fue devuelta para corrección${certification.reason ? `: ${certification.reason}` : '.'}`,
  }[certification.status];
  return `<div class="training-route-cert" data-status="${certification.status}"><strong>${escapar(certification.statusLabel)}</strong><p>${escapar(text)}</p>${certification.status === 'CERTIFICADO' ? '<a href="/induccion/certificado">Ver mi certificado →</a>' : ''}</div>`;
}

type CardState = 'active' | 'completed' | 'locked' | 'available';

const MODULE_IMAGES: Record<string, string> = {
  'ofimatica-mecanografia': '/imagenes/ofimatica-cobranzas-ilustracion.webp',
  'induccion-cobranzas': '/imagenes/induccion-cobranzas-ilustracion.webp',
  'simulador-cobranzas': '/imagenes/enfrentate-objecion-ilustracion.webp',
  'tipificacion-llamadas': '/imagenes/tipificacion-llamadas-ilustracion.webp',
  'examen-general': '/imagenes/certificado-ilustracion.webp',
};

function stateIcon(state: CardState): string {
  const paths: Record<CardState, string> = {
    active: '<path d="m9 5 7 7-7 7"/>',
    completed: '<path d="m5 12 4 4L19 6"/>',
    locked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    available: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[state]}</svg>`;
}

function card(module: ModuleView, current: boolean): string {
  const illustration = MODULE_IMAGES[module.slug];
  const percent = Math.max(0, Math.min(100, Number(module.progressPercent) || 0));
  const state: CardState = module.status === 'PASSED' ? 'completed' : !module.enabled ? 'locked' : current ? 'active' : 'available';
  const label = current
    ? `Estás aquí · ${statusLabel(module)}`
    : state === 'locked' && module.status === 'IN_PROGRESS' ? 'No disponible' : statusLabel(module);
  const button = module.enabled
    ? `<a class="path-card-action" href="${escapar(module.route)}">${escapar(module.actionLabel)} <span aria-hidden="true">→</span></a>`
    : `<button class="path-card-action" type="button" disabled>${stateIcon(state === 'completed' ? 'completed' : 'locked')}${escapar(module.actionLabel)}</button>`;
  const note = module.blockedReason
    ? `<p class="path-card-note">${escapar(module.blockedReason)}</p>`
    : module.waitUntil ? `<p class="path-card-note">Podrás intentarlo de nuevo desde ${escapar(formatDate(module.waitUntil))}.</p>`
      : state === 'locked' ? '<p class="path-card-note">Este módulo aún no está disponible.</p>' : '';
  return `
    <li class="path-card" data-status="${module.status}" data-state="${state}" data-enabled="${module.enabled}"${current ? ' aria-current="step"' : ''}>
      <div class="path-card-top"><span class="path-card-order">MÓDULO ${String(module.order).padStart(2, '0')}</span><span class="path-card-corner${illustration ? ' path-card-corner--illustrated' : ''}">${illustration ? `<img class="path-card-illustration" src="${escapar(illustration)}" alt="" width="1536" height="1024" decoding="async">` : ''}<span class="path-card-state-icon">${stateIcon(state)}</span></span></div>
      <div class="path-card-body">
        <h3>${escapar(module.name)}</h3>
        <span class="path-card-status">${escapar(label)}</span>
        <div class="path-card-progress"><span class="path-card-progress-label">Progreso</span><strong class="path-card-percent">${escapar(module.progressPercent)} %</strong></div>
        <div class="path-card-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="Progreso de ${escapar(module.name)}"><span style="width:${percent}%"></span></div>
        ${note}
      </div>
      ${button}
    </li>`;
}

// Oportunidades de mejora del sistema experto: aparecen cuando el asesor no logra certificarse (se queda sin
// intentos en un módulo, no aprueba el examen general o su certificación es devuelta).
type Improvement = { show: boolean; reason: string | null; summary: string; opportunities: { area: string; severity: 'alta' | 'media' | 'baja'; finding: string; recommendation: string; module: string }[] };
function improvementHtml(improvement: Improvement | null): string {
  if (!improvement?.show) return '';
  return `<section class="improvement-panel" aria-labelledby="improvement-title">
    <p class="improvement-kicker">TU PLAN DE MEJORA</p>
    <h3 id="improvement-title">Esto es lo que debes reforzar</h3>
    ${improvement.reason ? `<p class="improvement-reason">${escapar(improvement.reason)}</p>` : ''}
    <ol class="improvement-list">${improvement.opportunities.map((item) => `<li class="improvement-item improvement-item--${item.severity}">
      <span class="improvement-tag">${item.severity === 'alta' ? 'Prioridad alta' : 'Para mejorar'} · ${escapar(item.area)}</span>
      <p>${escapar(item.finding)}</p><p><strong>Qué hacer:</strong> ${escapar(item.recommendation)}</p><small>Dónde repasar: ${escapar(item.module)}</small></li>`).join('')}</ol>
    <p class="improvement-note">Repasa estos temas y, cuando estés listo, solicita la reactivación desde el módulo correspondiente.</p>
  </section>`;
}

// Sección "Tu ruta de formación" en la práctica, justo debajo de "Tu camino en Fontana".
export async function mountLearningPath(): Promise<void> {
  const main = document.querySelector('main');
  if (!main) return;
  const camino = main.querySelector('.learning-path');
  const section = document.createElement('section');
  section.className = 'training-route';
  section.setAttribute('aria-labelledby', 'training-route-title');
  section.innerHTML = '<div class="training-route-head"><h2 id="training-route-title" class="training-route-sr">Tu ruta de formación</h2><div class="training-route-summary" data-route-summary hidden></div><p class="training-route-lead">Cinco módulos, una meta: convertirte en asesor certificado. Cada paso se desbloquea al aprobar el anterior.</p></div><p class="training-route-loading">Cargando tus módulos…</p>';
  if (camino) camino.after(section); else main.prepend(section);
  try {
    const [{ data }, certification, improvement] = await Promise.all([
      api<{ data: ModuleView[] }>('/advisor/modules'),
      api<{ data: CertificationSummary }>('/advisor/certification').then((response) => response.data).catch(() => null),
      api<{ data: Improvement }>('/advisor/opportunities').then((response) => response.data).catch(() => null),
    ]);
    // El certificado es el resultado del examen, no una sexta tarjeta del recorrido.
    const modules = data.filter((module) => module.slug !== 'certificado');
    const current = modules.find((module) => module.enabled && module.status === 'IN_PROGRESS')
      ?? modules.find((module) => module.enabled && (module.status === 'AVAILABLE' || module.status === 'NOT_STARTED'));
    section.querySelector('.training-route-loading')!.remove();
    const done = modules.filter((module) => module.status === 'PASSED').length;
    const summary = section.querySelector<HTMLElement>('[data-route-summary]')!;
    summary.hidden = false;
    summary.innerHTML = `<strong>${done}<small> de ${modules.length}</small></strong><span>módulos completados</span><ol aria-hidden="true">${modules.map((module) => `<li${module.status === 'PASSED' ? ' class="is-done"' : ''}></li>`).join('')}</ol>`;
    // Aprobar el examen general desbloquea el paso 03 de «Tu camino en Fontana».
    if (examPassed(data)) camino?.querySelector('li:nth-child(3)')?.replaceWith(Object.assign(document.createElement('template'), { innerHTML: pasoEquipoDisponible() }).content);
    section.insertAdjacentHTML('beforeend', `${certificationBanner(certification)}${improvementHtml(improvement)}<p class="training-route-swipe-hint">Desliza para ver todos los módulos →</p><ol class="path-cards" tabindex="0" aria-label="Módulos de formación">${modules.map((module) => card(module, module === current)).join('')}</ol>`);
    // La primera vez después de la aprobación, la felicitación con el certificado. No se espera: el aula se
    // termina de mostrar y la felicitación aparece encima.
    if (certification?.status === 'CERTIFICADO') {
      void import('../certification/certificate').then(({ celebrateIfNew }) => celebrateIfNew(location.pathname));
    }
  } catch (error) {
    section.querySelector('.training-route-loading')!.textContent = (error as Error).message;
  }
}

const INDUCTION_SLUG = 'induccion-cobranzas';
// El módulo 03 conserva su slug técnico; su nombre visible es «Enfréntate a la objeción».
const OBJECTIONS_SLUG = 'simulador-cobranzas';
// El módulo 04 conserva su slug técnico; su nombre visible es «Tipifica».
const TIPIFICA_SLUG = 'tipificacion-llamadas';
const FINAL_EXAM_SLUG = 'examen-general';
const CERTIFICATE_SLUG = 'certificado';

// Primera pantalla de «Inducción a las cobranzas»: la experiencia define el camino. Quien es nuevo recorre la
// teoría; quien tiene experiencia presenta primero un examen diagnóstico y después recorre la misma teoría.
const expIcon = (path: string, width = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

// Portada del módulo 02: tarjeta centrada con la elección de experiencia.
function expIntroHtml(backHref: string): string {
  return `<section class="exp-intro-layout">
      <div class="exp-panel">
        ${experienceFormHtml()}
        <a class="secondary-link" href="${escapar(backHref)}">← Volver a tu ruta</a>
      </div>
    </section>`;
}

// Enlaza el envío de la elección de experiencia (igual comportamiento, cualquiera sea el contenedor que la aloja).
function wireExperienceForm(form: HTMLFormElement | null, container: HTMLElement, backHref: string): void {
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answer = new FormData(form).get('experience');
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const error = form.querySelector<HTMLElement>('#experience-error')!;
    button.disabled = true;
    error.hidden = true;
    showAppLoading(answer === 'experienced' ? 'Preparando tu diagnóstico…' : 'Preparando tu ruta de formación…');
    try {
      await api('/auth/experiencia', { method: 'POST', body: JSON.stringify({ tieneExperienciaCobranzasDigitales: answer === 'experienced' }) });
      await renderModulePage(container, backHref, answer === 'experienced');
      await revealApp();
    } catch (failure) {
      await revealApp();
      error.textContent = (failure as Error).message;
      error.hidden = false;
      button.disabled = false;
    }
  });
}

function experienceFormHtml(): string {
  const check = expIcon('<path d="m5 13 4 4L19 7"/>', 3);
  const arrow = '<i aria-hidden="true">→</i>';
  return `<form id="experience-form" class="exp-form">
      <div class="exp-choose">
        <p class="auth-kicker">CONOZCAMOS TU EXPERIENCIA</p>
        <h3>¿Cuál es tu punto de partida?</h3>
        <p>Esto define tu camino en el módulo. Elige la opción que mejor te describa.</p>
      </div>
      <div class="exp-options" role="radiogroup" aria-label="Tu experiencia en cobranzas digitales">
        <label class="exp-option">
          <input type="radio" name="experience" value="experienced" required>
          <span class="exp-option-body">
            <span class="exp-option-icon">${expIcon('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>')}</span>
            <span class="exp-option-head"><strong>Tengo experiencia</strong></span>
          </span>
          <span class="exp-check">${check}</span>
        </label>
        <label class="exp-option">
          <input type="radio" name="experience" value="new" required>
          <span class="exp-option-body">
            <span class="exp-option-icon">${expIcon('<path d="M12 21v-9"/><path d="M12 12c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z"/><path d="M12 14c0-2.8-2.2-5-5-5 0 2.8 2.2 5 5 5Z"/>')}</span>
            <span class="exp-option-head"><strong>Soy completamente nuevo</strong></span>
          </span>
          <span class="exp-check">${check}</span>
        </label>
      </div>
      <p id="experience-error" class="feedback feedback-error" role="alert" hidden></p>
      <button type="submit" class="primary-action">Confirmar y empezar el módulo ${arrow}</button>
    </form>`;
}

const examPassed = (modules: ModuleView[]): boolean => modules.some((module) => module.slug === FINAL_EXAM_SLUG && module.status === 'PASSED');
async function teamWelcomeUnlocked(): Promise<boolean> {
  return examPassed((await api<{ data: ModuleView[] }>('/advisor/modules')).data);
}

// Rutas /induccion/modulos/:slug y /induccion/certificado: el servidor valida el acceso.
export async function renderModulePage(container: HTMLElement, backHref = '/induccion', experience: boolean | null = null): Promise<void> {
  // El fondo de marca solo cubre la portada del módulo 02; cualquier otra vista lo quita.
  document.body.classList.remove('exp-intro-screen');
  // Paso 03 «Trabaja con nosotros»: la bienvenida solo se abre con el examen general aprobado.
  if (location.pathname.replace(/\/$/, '') === TEAM_WELCOME_ROUTE) {
    container.innerHTML = '<section class="auth-card narrow module-page"><p>Cargando…</p></section>';
    try {
      if (!await teamWelcomeUnlocked()) {
        container.innerHTML = `<section class="auth-card narrow module-page"><h2>Trabaja con nosotros</h2><p>Se desbloquea al aprobar el examen general.</p><a class="secondary-link" href="${escapar(backHref)}">← Volver a tu ruta</a></section>`;
        return;
      }
      const { mountTeamWelcome } = await import('../welcome/team-welcome');
      mountTeamWelcome(container, { backHref });
    } catch (error) {
      container.innerHTML = `<section class="auth-card narrow module-page"><p role="alert">${escapar((error as Error).message)}</p><a class="secondary-link" href="${escapar(backHref)}">← Volver a tu ruta</a></section>`;
    }
    return;
  }
  const slug = location.pathname === '/induccion/certificado' ? 'certificado' : decodeURIComponent(location.pathname.split('/')[3] ?? '');
  // Con la experiencia respondida, el módulo propio decide el camino: teoría y examen, o examen primero.
  if (slug === INDUCTION_SLUG && experience !== null) {
    const { mountCollections } = await import('../collections/collections');
    await mountCollections(container, backHref);
    return;
  }
  // El certificado tiene su propia página (estado de la validación, certificado y felicitación).
  if (slug === CERTIFICATE_SLUG) {
    const { mountCertificatePage } = await import('../certification/certificate');
    await mountCertificatePage(container, backHref);
    return;
  }
  container.innerHTML = '<section class="auth-card narrow module-page"><p>Cargando módulo…</p></section>';
  const page = container.querySelector<HTMLElement>('.module-page')!;
  try {
    const { data } = await api<{ data: { module: ModuleView; activities: { title: string; enabled: boolean; blockedReason: string | null }[]; content: { message: string } } }>(`/advisor/modules/${encodeURIComponent(slug)}`);
    // El acceso ya se validó arriba (prerrequisitos, estado): el módulo 03 tiene su propia aplicación.
    if (slug === OBJECTIONS_SLUG) {
      const { mountObjections } = await import('../objections/objections');
      await mountObjections(container, backHref);
      return;
    }
    // Módulo 05 «Examen general»: evaluación ABCD de un intento.
    if (slug === FINAL_EXAM_SLUG) {
      const { mountFinalExam } = await import('../final-exam/final-exam');
      await mountFinalExam(container, backHref, data.module.order);
      return;
    }
    // Módulo 04 «Tipifica»: práctica en el clon de Control Next.
    if (slug === TIPIFICA_SLUG) {
      const { mountTipifica } = await import('../tipifica/tipifica');
      await mountTipifica(container, backHref, data.module.order);
      return;
    }
    // Portada del módulo 02 (antes de elegir experiencia): layout de dos paneles con fondo de marca.
    if (slug === INDUCTION_SLUG) {
      document.body.classList.add('exp-intro-screen');
      container.innerHTML = expIntroHtml(backHref);
      wireExperienceForm(container.querySelector<HTMLFormElement>('#experience-form'), container, backHref);
      return;
    }
    page.innerHTML = `
      <div class="fontana-progress-row">
        <div>
      <p class="auth-kicker">MÓDULO ${String(data.module.order).padStart(2, '0')}</p>
      <h2>${escapar(data.module.name)}</h2>
        </div>
        ${progressGuide(backHref)}
      </div>
      <div class="module-placeholder"><strong>${escapar(data.content.message)}</strong><p>Este espacio mostrará las actividades del módulo cuando estén listas.</p></div>
      ${data.activities.length ? `<ul class="module-activities">${data.activities.map((activity) => `<li>${escapar(activity.title)}${activity.enabled ? '' : ` · <em>${escapar(activity.blockedReason)}</em>`}</li>`).join('')}</ul>` : ''}
      <a class="secondary-link" href="${escapar(backHref)}">← Volver a tu ruta</a>`;
  } catch (error) {
    const reason = error instanceof ApiError && typeof error.details?.blockedReason === 'string' ? error.details.blockedReason : (error as Error).message;
    page.innerHTML = `
      <p class="auth-kicker">ACCESO NO DISPONIBLE</p>
      <h2>Todavía no puedes entrar a este módulo</h2>
      <p class="feedback feedback-error">${escapar(reason)}</p>
      <a class="secondary-link" href="${escapar(backHref)}">← Volver a tu ruta</a>`;
  }
}
