import './admin.css';
import { api, escapar, formatDate } from '../http';
import { officeFileHtml, officeSection } from './office-admin';
import { mountCollectionsHistory } from './collections-admin';
import { mountPerformanceReport } from './performance-report-admin';
import { certificationSection } from './certification-admin';

// Panel administrativo. Navegación por hash dentro de /admin:
// #asesores, #ficha/<id>, #validacion (y sus pestañas), #expediente/<id>, #modulos, #ofimatica, #metricas, #auditoria.

type Usuario = { id: string; nombreCompleto: string; numeroDocumento: string; rol: string; estado: string; correo: string | null; telefono: string | null; debeCompletarDatos: boolean; tieneExperienciaCobranzasDigitales?: boolean | null; fechaCreacion: string; ultimoAcceso: string | null };
type Shell = (title: string, subtitle: string, content: string) => void;
type Page<T> = { data: T[]; meta: { nextCursor: string | null; total?: number } };

const STATUS_TEXT: Record<string, string> = {
  NOT_STARTED: 'Sin iniciar', AVAILABLE: 'Disponible', IN_PROGRESS: 'En curso', PASSED: 'Aprobado', FAILED: 'Sin intentos', BLOCKED: 'Bloqueado',
  ACTIVE: 'Activo', INACTIVE: 'Inactivo', DRAFT: 'Borrador', ARCHIVED: 'Archivado', REVOKED: 'Anulado', REISSUED: 'Reemitido',
  SUBMITTED: 'Enviado', CANCELLED: 'Cancelado', VIGENTE: 'Vigente', VENCIDA: 'Vencida', REVOCADA: 'Revocada', CONSUMIDA: 'Consumida',
};
const ACTION_TEXT: Record<string, string> = {
  REACTIVATE: 'Reactivar actividad', EXTRA_ATTEMPT: 'Intento adicional', RESET_WAIT: 'Quitar tiempo de espera', UNLOCK: 'Desbloquear módulo', REOPEN_MODULE: 'Reabrir módulo',
};

// Cuenta de pruebas con reinicio de curso (el servidor también lo exige).
const COURSE_RESET_DOCUMENT = '1021803088';

// Borra todo el progreso del asesor para volver a probar el curso desde cero.
async function resetCourse(user: { id: string; nombreCompleto: string }, after: () => unknown): Promise<void> {
  const data = await askForm(`Reiniciar el curso de ${user.nombreCompleto}`, `
    <p class="dialog-note dialog-danger"><strong>Se reiniciará su progreso:</strong> intentos de otras actividades, sellos, certificados, excepciones, cupos de intentos, lecciones vistas, su respuesta de experiencia y la inducción inicial. Empezará desde cero. Se conservan la cuenta, la auditoría y el historial del examen de cobranzas. No se puede deshacer.</p>`, { submit: 'Reiniciar curso' });
  if (!data) return;
  await run(() => api(`/admin/users/${user.id}/reset-course`, { method: 'POST', body: JSON.stringify({ reason: data.reason }) }), 'Curso reiniciado: el asesor empieza desde cero.', after);
}

const text = (value: string) => STATUS_TEXT[value] ?? value;
const badge = (value: string) => `<span class="status status-${escapar(value.toLowerCase())}">${escapar(text(value))}</span>`;
const empty = (columns: number, message = 'Sin registros.') => `<tr><td colspan="${columns}" class="empty-row">${message}</td></tr>`;

function feedback(message: string, error = false): void {
  const target = document.querySelector<HTMLElement>('#admin-feedback');
  if (!target) return;
  target.textContent = message;
  target.className = `feedback ${error ? 'feedback-error' : 'feedback-ok'}`;
  target.hidden = false;
  target.scrollIntoView({ block: 'nearest' });
}

// Diálogo genérico que exige motivo. Devuelve los datos del formulario o null si se cancela.
function askForm(title: string, fields: string, options: { reason?: boolean; submit?: string; validate?: (data: Record<string, string>) => string | null } = {}): Promise<Record<string, string> | null> {
  const dialog = document.querySelector<HTMLDialogElement>('#admin-dialog')!;
  dialog.innerHTML = `<form method="dialog" class="auth-form">
    <h2>${escapar(title)}</h2>${fields}
    ${options.reason === false ? '' : '<label>Motivo <small>Obligatorio, mínimo 10 caracteres</small><textarea name="reason" required minlength="10" maxlength="500" rows="3"></textarea></label>'}
    <p class="dialog-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="secondary-action" data-cancel>Cancelar</button><button class="primary-action" value="ok">${escapar(options.submit ?? 'Confirmar')}</button></div>
  </form>`;
  return new Promise((resolve) => {
    const form = dialog.querySelector('form')!;
    dialog.querySelector('[data-cancel]')!.addEventListener('click', () => { dialog.close(); resolve(null); });
    form.addEventListener('submit', (event) => {
      if (!form.reportValidity()) { event.preventDefault(); return; }
      const data = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]));
      const problem = options.validate?.(data) ?? null;
      if (problem) {
        event.preventDefault();
        const box = dialog.querySelector<HTMLElement>('.dialog-error')!;
        box.textContent = problem;
        box.hidden = false;
        return;
      }
      resolve(data);
    });
    dialog.addEventListener('cancel', () => resolve(null), { once: true });
    dialog.showModal();
  });
}

// Sección actual del panel. rerender la vuelve a pedir al servidor y espera a que termine de dibujarse,
// para que el aviso de carga no desaparezca antes de que se vean los datos nuevos.
let currentRoute: (() => Promise<void>) | null = null;
function rerender(): Promise<void> {
  return currentRoute ? currentRoute() : Promise.resolve();
}

// Aviso de carga: cubre el panel mientras se guarda un cambio y se recargan los datos.
function busy(message: string | null): void {
  const overlay = document.querySelector<HTMLElement>('#admin-busy');
  if (!overlay) return;
  overlay.hidden = message === null;
  if (message) overlay.querySelector('p')!.textContent = message;
}

async function run(action: () => Promise<unknown>, success: string, after?: () => unknown): Promise<void> {
  busy('Guardando cambios…');
  try {
    await action();
    busy('Actualizando la información…');
    await after?.();
    feedback(success);
  } catch (error) {
    feedback((error as Error).message, true);
  } finally {
    busy(null);
  }
}

// ---------------------------------------------------------------------------------------------
// Asesores

// Un solo diálogo para todo lo del usuario: datos, estado y contraseña (esta última solo en asesores).
async function editUser(user: Usuario, after: () => unknown): Promise<void> {
  const isAdvisor = user.rol === 'asesor';
  const data = await askForm(`Editar a ${user.nombreCompleto}`, `
    <fieldset class="dialog-group"><legend>Datos</legend>
      <label>Nombre completo<input name="nombreCompleto" required maxlength="150" value="${escapar(user.nombreCompleto)}"></label>
      <label>Número de documento<input name="numeroDocumento" required maxlength="30" value="${escapar(user.numeroDocumento)}"></label>
      <label>Correo<input name="correo" type="email" maxlength="150" value="${escapar(user.correo)}"></label>
      <label>Teléfono<input name="telefono" maxlength="30" value="${escapar(user.telefono)}"></label>
      <label>Rol<select name="rol"><option value="asesor" ${isAdvisor ? 'selected' : ''}>Asesor</option><option value="administrador" ${!isAdvisor ? 'selected' : ''}>Administrador</option></select></label>
    </fieldset>
    <fieldset class="dialog-group"><legend>Acceso</legend>
      <label>Estado de la cuenta<select name="estado">${['activo', 'inactivo', 'bloqueado'].map((s) => `<option value="${s}" ${s === user.estado ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      <small class="dialog-hint">Desactivar o bloquear cierra de inmediato las sesiones abiertas. El historial se conserva.</small>
      ${isAdvisor ? `<label>Nueva contraseña <small>Déjala vacía para no cambiarla</small><input name="password" type="password" minlength="10" maxlength="72" autocomplete="new-password"></label>
      <small class="dialog-hint">El asesor deberá cambiarla en su próximo ingreso y sus sesiones abiertas se cerrarán.</small>` : ''}
    </fieldset>
    <label>Motivo <small>Obligatorio (mínimo 10 caracteres) si cambias el estado o la contraseña</small><textarea name="reason" maxlength="500" rows="2"></textarea></label>`, {
    reason: false,
    submit: 'Guardar cambios',
    validate: (form) => ((form.estado !== user.estado || form.password) && form.reason.trim().length < 10 ? 'Escribe un motivo de al menos 10 caracteres para cambiar el estado o la contraseña.' : null),
  });
  if (!data) return;
  const reason = data.reason.trim();
  busy('Guardando cambios…');
  try {
    const body: Record<string, unknown> = { nombreCompleto: data.nombreCompleto, numeroDocumento: data.numeroDocumento, telefono: data.telefono || null };
    if (data.correo) body.correo = data.correo;
    if (data.rol !== user.rol) body.rol = data.rol;
    await api(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (data.estado !== user.estado) await api(`/admin/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ estado: data.estado, reason }) });
    if (data.password) await api(`/admin/users/${user.id}/password`, { method: 'PUT', body: JSON.stringify({ password: data.password, reason }) });
    busy('Actualizando la información…');
    await after();
    feedback(data.password ? 'Cambios guardados y contraseña actualizada.' : 'Cambios guardados.');
  } catch (error) { feedback((error as Error).message, true); } finally { busy(null); }
}

// Columnas de la tabla de usuarios que se pueden ordenar; la clave coincide con sortBy del servidor.
const USER_COLUMNS = [
  { key: 'nombre', label: 'Usuario' }, { key: 'documento', label: 'Documento' }, { key: 'rol', label: 'Rol' },
  { key: 'estado', label: 'Estado' }, { key: 'perfil', label: 'Perfil' }, { key: 'ultimoAcceso', label: 'Último acceso' },
];

async function advisorsSection(view: HTMLElement): Promise<void> {
  view.innerHTML = `
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Registrar usuario</h2><p>Los asesores completan su perfil al ingresar.</p></div></div>
      <form id="create-form" class="admin-form">
        <label>Nombre completo<input name="nombreCompleto" required maxlength="150" autocomplete="name"></label>
        <label>Número de documento<input name="numeroDocumento" required maxlength="30" inputmode="numeric"></label>
        <label>Contraseña temporal<input name="password" type="password" required minlength="10" maxlength="72" autocomplete="new-password"></label>
        <label>Rol<select name="rol"><option value="asesor">Asesor</option><option value="administrador">Administrador</option></select></label>
        <button class="primary-action">Crear usuario</button>
      </form>
    </section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Usuarios</h2><p id="total-caption">Cargando…</p></div></div>
      <form id="filter-form" class="filter-grid">
        <input name="search" type="search" placeholder="Buscar por nombre o documento" aria-label="Buscar por nombre o documento">
        <button type="submit">Buscar</button>
      </form>
      <div class="table-wrap"><table><thead><tr>
        ${USER_COLUMNS.map((column) => `<th aria-sort="none" data-col="${column.key}"><button type="button" class="sort-button" data-sort="${column.key}">${column.label}<span class="sort-arrow" aria-hidden="true"></span></button></th>`).join('')}
        <th>Acciones</th></tr></thead><tbody id="user-rows"></tbody></table></div>
      <div class="pagination"><button id="more" type="button" hidden>Cargar más</button></div>
    </section>`;

  const rows = view.querySelector<HTMLTableSectionElement>('#user-rows')!;
  const more = view.querySelector<HTMLButtonElement>('#more')!;
  let cursor: string | null = null;
  let filters = new URLSearchParams();
  // Orden por columna: clic en el encabezado alterna ascendente → descendente → orden por defecto.
  let sort: { key: string; dir: 'asc' | 'desc' } | null = null;
  const loaded = new Map<string, Usuario>();

  async function load(reset: boolean): Promise<void> {
    if (reset) { cursor = null; rows.innerHTML = ''; loaded.clear(); }
    const query = new URLSearchParams(filters);
    query.set('limit', '20');
    if (sort) { query.set('sortBy', sort.key); query.set('sortDir', sort.dir); }
    if (cursor) query.set('cursor', cursor);
    const page = await api<Page<Usuario>>(`/admin/users?${query}`);
    view.querySelector('#total-caption')!.textContent = `${page.meta.total ?? page.data.length} usuario(s) con estos filtros`;
    for (const user of page.data) loaded.set(user.id, user);
    rows.insertAdjacentHTML('beforeend', page.data.map((user) => `<tr>
      <td><strong>${escapar(user.nombreCompleto)}</strong></td><td>${escapar(user.numeroDocumento)}</td><td>${escapar(user.rol)}</td>
      <td>${badge(user.estado === 'activo' ? 'ACTIVE' : user.estado === 'bloqueado' ? 'BLOCKED' : 'INACTIVE').replace(/>[^<]+</, `>${escapar(user.estado)}<`)}</td>
      <td>${user.rol === 'asesor' ? (user.debeCompletarDatos ? 'Pendiente' : 'Completo') : '—'}</td><td>${formatDate(user.ultimoAcceso)}</td>
      <td class="row-actions">
        ${user.rol === 'asesor' ? `<a class="row-action" href="#ficha/${user.id}">Ver avance</a>` : ''}
        <button class="row-action" data-action="edit" data-id="${user.id}">Editar</button>
        ${user.numeroDocumento === COURSE_RESET_DOCUMENT ? `<button class="row-action row-action-danger" data-action="reset-course" data-id="${user.id}">Reiniciar curso</button>` : ''}
      </td></tr>`).join('') || (reset ? empty(7, 'No hay usuarios para mostrar.') : ''));
    cursor = page.meta.nextCursor;
    more.hidden = !cursor;
  }

  rows.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const user = loaded.get(button.dataset.id!)!;
    if (button.dataset.action === 'edit') await editUser(user, () => load(true));
    else if (button.dataset.action === 'reset-course') await resetCourse(user, () => load(true));
  });

  view.querySelector<HTMLFormElement>('#create-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    await run(() => api('/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }), 'Usuario creado y activo.', () => { form.reset(); return load(true); });
  });
  view.querySelector('thead')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sort]');
    if (!button) return;
    const key = button.dataset.sort!;
    sort = sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null;
    view.querySelectorAll<HTMLElement>('th[data-col]').forEach((th) => {
      const active = sort?.key === th.dataset.col;
      th.setAttribute('aria-sort', active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.sort-arrow')!.textContent = active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : '';
    });
    void load(true).catch((error) => feedback((error as Error).message, true));
  });
  view.querySelector<HTMLFormElement>('#filter-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    filters = new URLSearchParams([...new FormData(event.currentTarget as HTMLFormElement)].filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)]));
    void load(true).catch((error) => feedback((error as Error).message, true));
  });
  more.addEventListener('click', () => void load(false).catch((error) => feedback((error as Error).message, true)));
  await load(true);
}

// ---------------------------------------------------------------------------------------------
// Ficha del asesor

type AdvisorActivity = {
  activityId: string; title: string; type: string; order: number; status: string; isRequired: boolean; hasEvaluation: boolean;
  attemptsRemaining: number | null; attemptsUsed: number; attemptsMax: number | null; customLimit: boolean; passed: boolean;
  exhausted: boolean; waitUntil: string | null; nextAttemptNumber: number | null;
};
type AdvisorFile = {
  user: Usuario;
  welcomeCompleted?: boolean;
  modules: { moduleId: string; slug: string; name: string; order: number; status: string; catalogStatus: string; progressPercent: string; blockedReason: string | null; hasSeal: boolean; lastActivityAt: string | null }[];
  catalog: { moduleId: string; name: string; order: number; activities: AdvisorActivity[] }[];
  activities: { activityId: string; status: string }[];
  attempts: { id: string; number: number; status: string; score: string | null; startedAt: string; submittedAt: string | null; durationSeconds: number | null; evaluation: { version: number; activity: { title: string } } }[];
  seals: { id: string; status: string; issuedAt: string; module: { name: string } }[];
  certificates: { id: string; code: string; status: string; issuedAt: string; revokedAt: string | null; revokeReason: string | null; previousCertificateId: string | null }[];
  overrides: { id: string; action: string; extraAttempts: number; reason: string; expiresAt: string | null; revokedAt: string | null; createdAt: string; state: string; activity: { title: string; module: { name: string } }; createdBy: { nombreCompleto: string } }[];
  audit: { id: string; action: string; reason: string | null; createdAt: string; actor: { nombreCompleto: string } }[];
  office?: Parameters<typeof officeFileHtml>[0];
};

const ACTIVITY_TYPE_TEXT: Record<string, string> = {
  LESSON: 'Lección', QUIZ: 'Evaluación', TYPING: 'Mecanografía', SIMULATOR: 'Simulador', TYPIFICATION: 'Tipificación',
  EXCEL_PRACTICE: 'Práctica de Excel', DICTATION: 'Dictado', PLACEHOLDER: 'Contenido',
};
const CERTIFICATE_SLUG = 'certificado';
// Las lecciones y los contenidos en preparación no se califican: no tienen evaluación que configurar.
const UNGRADED_TYPES = new Set(['LESSON', 'PLACEHOLDER']);

const pill = (kind: string, label: string) => `<span class="status status-${kind}">${escapar(label)}</span>`;

// Resume una actividad en una sola etiqueta que el administrador entienda de un vistazo.
function activityPill(activity: AdvisorActivity, moduleStatus: string, progress: string | undefined): string {
  if (activity.status !== 'ACTIVE') return pill('draft', 'Inactiva');
  // Las actividades sin evaluación (lecciones) no llevan nota: solo se marcan como realizadas.
  if (!activity.hasEvaluation) return progress === 'PASSED' ? pill('passed', 'Realizado') : pill('not_started', 'Pendiente');
  if (activity.passed || progress === 'PASSED') return pill('passed', 'Aprobada');
  if (activity.exhausted) return pill('failed', 'Sin intentos');
  if (moduleStatus === 'BLOCKED') return pill('blocked', 'Bloqueada');
  if (activity.waitUntil) return pill('in_progress', 'En espera');
  if (progress === 'IN_PROGRESS') return pill('in_progress', 'En curso');
  if (progress === 'AVAILABLE' || activity.attemptsUsed > 0) return pill('available', 'Disponible');
  return pill('not_started', 'Sin iniciar');
}

function moduleVerdict(view: AdvisorFile['modules'][number]): string {
  if (view.catalogStatus !== 'ACTIVE') return pill('draft', 'No disponible');
  if (view.status === 'PASSED') return pill('passed', 'Completado');
  if (view.status === 'FAILED') return pill('failed', 'Sin intentos');
  if (view.status === 'BLOCKED') return pill('blocked', 'Bloqueado');
  if (view.status === 'IN_PROGRESS') return pill('in_progress', 'En curso');
  return pill('available', 'Disponible');
}

function activityRow(activity: AdvisorActivity, moduleStatus: string, progress: string | undefined, isCurrent: boolean): string {
  const attempts = !activity.hasEvaluation ? '' : `
    <span class="attempts"><strong>${activity.attemptsUsed}</strong> de <strong>${activity.attemptsMax ?? '—'}</strong> intentos${activity.customLimit ? ' <em class="tag">ajustado</em>' : ''}</span>
    <span class="muted">Le quedan ${activity.attemptsRemaining ?? 0}</span>`;
  const wait = activity.waitUntil ? `<span class="wait">Podrá reintentar desde ${escapar(formatDate(activity.waitUntil))}</span>` : '';
  const actions = [
    activity.exhausted ? `<button class="primary-small" data-reactivate="${activity.activityId}" data-title="${escapar(activity.title)}">Reactivar prueba</button>` : '',
    activity.waitUntil ? `<button class="row-action" data-reset-wait="${activity.activityId}" data-title="${escapar(activity.title)}">Quitar espera</button>` : '',
    activity.hasEvaluation ? `<button class="row-action" data-limit="${activity.activityId}" data-title="${escapar(activity.title)}" data-used="${activity.attemptsUsed}" data-max="${activity.attemptsMax ?? 1}" data-custom="${activity.customLimit}">Cambiar intentos</button>` : '',
  ].join('');
  return `<li class="activity-item${isCurrent ? ' is-current' : ''}">
    <div class="activity-main"><strong>${escapar(activity.title)}</strong><span class="muted">${escapar(ACTIVITY_TYPE_TEXT[activity.type] ?? activity.type)}${activity.isRequired ? '' : ' · opcional'}</span></div>
    <div class="activity-state">${activityPill(activity, moduleStatus, progress)}</div>
    <div class="activity-attempts">${attempts}${wait}</div>
    <div class="activity-actions">${actions}</div></li>`;
}

async function advisorFileSection(view: HTMLElement, userId: string): Promise<void> {
  const { data } = await api<{ data: AdvisorFile }>(`/admin/advisors/${userId}/progress`);
  const progressOf = new Map(data.activities.map((row) => [row.activityId, row.status]));
  const catalogOf = new Map(data.catalog.map((module) => [module.moduleId, module]));
  const modules = [...data.modules].sort((a, b) => a.order - b.order);
  const learning = modules.filter((module) => module.slug !== CERTIFICATE_SLUG && module.catalogStatus === 'ACTIVE');
  const overall = learning.length ? learning.reduce((sum, module) => sum + Number(module.progressPercent), 0) / learning.length : 0;
  const passedModules = learning.filter((module) => module.status === 'PASSED' || module.hasSeal).length;

  // "Dónde va": primer módulo activo sin completar que no esté bloqueado; si no hay, el primero pendiente.
  const pending = modules.filter((module) => module.catalogStatus === 'ACTIVE' && module.status !== 'PASSED' && !module.hasSeal);
  const currentModule = pending.find((module) => module.status !== 'BLOCKED') ?? pending[0] ?? null;
  const currentActivities = currentModule ? [...(catalogOf.get(currentModule.moduleId)?.activities ?? [])].sort((a, b) => a.order - b.order) : [];
  const currentActivity = currentActivities.find((activity) => activity.status === 'ACTIVE' && activity.isRequired && !activity.passed && progressOf.get(activity.activityId) !== 'PASSED') ?? null;
  const whereText = !currentModule ? 'Ruta completada' : escapar(currentModule.name);
  const whereSub = !currentModule ? 'Terminó todos los módulos disponibles.' : currentActivity ? `Actividad: ${escapar(currentActivity.title)}` : escapar(currentModule.blockedReason ?? 'Sin actividades pendientes.');

  // Cuenta de pruebas: interruptor por módulo para darlo por completado o vaciarlo.
  const testAccount = data.user.numeroDocumento === COURSE_RESET_DOCUMENT;
  const testToggle = (module: AdvisorFile['modules'][number]): string => {
    if (!testAccount || module.slug === CERTIFICATE_SLUG) return '';
    const done = module.status === 'PASSED' || module.hasSeal;
    return `<button type="button" class="test-toggle${done ? ' is-on' : ''}" role="switch" aria-checked="${done}" data-test-toggle="${module.moduleId}" data-name="${escapar(module.name)}" data-done="${done}"
      title="${done ? 'Vaciar el módulo para volver a probarlo' : 'Darlo por completado'}"><span class="test-toggle__track" aria-hidden="true"><span></span></span><span class="test-toggle__text">${done ? 'Completado' : 'Vacío'}</span></button>`;
  };

  const welcomeCard = !testAccount ? '' : `<div class="module-card module-card--flat">
      <div class="module-flat"><span class="module-order">0</span><span class="module-title"><strong>Bienvenida</strong><small>Historia, método y principios de trabajo</small></span>
        <button type="button" class="test-toggle${data.welcomeCompleted ? ' is-on' : ''}" role="switch" aria-checked="${Boolean(data.welcomeCompleted)}" data-test-welcome data-done="${Boolean(data.welcomeCompleted)}">
          <span class="test-toggle__track" aria-hidden="true"><span></span></span><span class="test-toggle__text">${data.welcomeCompleted ? 'Completado' : 'Vacío'}</span></button></div>
    </div>`;

  const moduleCards = modules.map((module) => {
    const activities = [...(catalogOf.get(module.moduleId)?.activities ?? [])].sort((a, b) => a.order - b.order);
    const required = activities.filter((activity) => activity.status === 'ACTIVE' && activity.isRequired);
    const done = required.filter((activity) => activity.passed || progressOf.get(activity.activityId) === 'PASSED').length;
    const isCurrent = currentModule?.moduleId === module.moduleId;
    const percent = Math.round(Number(module.progressPercent));
    return `<details class="module-card${isCurrent ? ' is-current' : ''}" ${module.status === 'PASSED' && !isCurrent ? '' : 'open'}>
      <summary>
        <span class="module-order">${module.order}</span>
        <span class="module-title"><strong>${escapar(module.name)}</strong>${isCurrent ? ' <em class="tag tag-current">Aquí va</em>' : ''}
          <small>${required.length ? `${done} de ${required.length} actividades aprobadas` : 'Sin actividades obligatorias'}${module.hasSeal ? ' · Sello obtenido' : ''}${module.lastActivityAt ? ` · Último avance ${escapar(formatDate(module.lastActivityAt))}` : ''}</small></span>
        ${moduleVerdict(module)}
        ${testToggle(module)}
        <span class="module-percent"><span class="bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></span><b>${percent} %</b></span>
      </summary>
      ${module.blockedReason && module.status !== 'PASSED' ? `<p class="module-note">${escapar(module.blockedReason)}</p>` : ''}
      <ul class="activity-list">${activities.map((activity) => activityRow(activity, module.status, progressOf.get(activity.activityId), isCurrent && currentActivity?.activityId === activity.activityId)).join('') || '<li class="activity-empty">Este módulo aún no tiene actividades.</li>'}</ul>
    </details>`;
  }).join('');

  const history = (title: string, body: string) => `<details class="auth-card admin-card history"><summary>${title}</summary>${body}</details>`;
  view.innerHTML = `
    <a class="secondary-link" href="#asesores">← Volver a usuarios</a>
    <section class="auth-card admin-card file-head">
      <div><h2>${escapar(data.user.nombreCompleto)}</h2>
        <p>Documento ${escapar(data.user.numeroDocumento)} · ${escapar(data.user.correo ?? 'sin correo')} · experiencia: ${data.user.tieneExperienciaCobranzasDigitales === true ? 'con experiencia' : data.user.tieneExperienciaCobranzasDigitales === false ? 'nuevo' : 'sin responder'} · último acceso ${escapar(formatDate(data.user.ultimoAcceso))}</p></div>
      <div class="file-head-actions"><a class="row-action" href="#expediente/${data.user.id}">Expediente de certificación</a>${data.user.numeroDocumento === COURSE_RESET_DOCUMENT ? '<button class="row-action row-action-danger" data-reset-course>Reiniciar curso</button>' : ''}
      ${pill(data.user.estado === 'activo' ? 'active' : data.user.estado === 'bloqueado' ? 'blocked' : 'inactive', data.user.estado.charAt(0).toUpperCase() + data.user.estado.slice(1))}</div>
    </section>
    <section class="stat-grid">
      <div class="stat stat-wide"><span>Dónde va</span><strong>${whereText}</strong><small>${whereSub}</small></div>
      <div class="stat"><span>Avance general</span><strong>${Math.round(overall)} %</strong><span class="bar"><span style="width:${Math.round(overall)}%"></span></span></div>
      <div class="stat"><span>Módulos completados</span><strong>${passedModules} de ${learning.length}</strong><small>Sellos obtenidos</small></div>
    </section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Ruta de formación</h2>
      <p>Módulos en orden. Reactiva la prueba cuando se quede sin intentos o ajusta cuántos intentos tiene en cada actividad.</p>
      ${testAccount ? '<p class="dialog-note"><strong>Cuenta de pruebas:</strong> con el interruptor de cada módulo lo das por <strong>completado</strong> (aprueba sus actividades, emite el sello y desbloquea el siguiente; igual puede abrirlas y hacerlas) o lo dejas <strong>vacío</strong> para probarlo de cero.</p>' : ''}</div></div>
      <div class="module-list">${welcomeCard}${moduleCards}</div></section>
    <div id="advisor-performance-report"></div>
    <div id="advisor-collections-history"></div>
    ${history('Historial de intentos y notas', `<div class="table-wrap"><table><thead><tr><th>#</th><th>Actividad</th><th>Versión</th><th>Estado</th><th>Nota</th><th>Inicio</th><th>Envío</th><th>Duración</th></tr></thead><tbody>
      ${data.attempts.map((a) => `<tr><td>${a.number}</td><td>${escapar(a.evaluation.activity.title)}</td><td>v${a.evaluation.version}</td><td>${badge(a.status)}</td><td>${escapar(a.score ?? '—')}</td><td>${formatDate(a.startedAt)}</td><td>${formatDate(a.submittedAt)}</td><td>${a.durationSeconds !== null ? `${Math.round(a.durationSeconds / 60)} min` : '—'}</td></tr>`).join('') || empty(8)}
      </tbody></table></div>`)}
    ${data.office ? history('Resultados de Ofimática', officeFileHtml(data.office, { badge, empty })) : ''}
    ${history('Sellos y certificados', `<div class="table-wrap"><table><thead><tr><th>Sello</th><th>Estado</th><th>Emitido</th></tr></thead><tbody>
      ${data.seals.map((s) => `<tr><td>${escapar(s.module.name)}</td><td>${badge(s.status)}</td><td>${formatDate(s.issuedAt)}</td></tr>`).join('') || empty(3)}
      </tbody></table></div>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>Estado</th><th>Emitido</th><th>Anulado</th><th>Motivo</th><th>Reemplaza a</th><th></th></tr></thead><tbody>
      ${data.certificates.map((c) => `<tr><td><strong>${escapar(c.code)}</strong></td><td>${badge(c.status)}</td><td>${formatDate(c.issuedAt)}</td><td>${formatDate(c.revokedAt)}</td><td>${escapar(c.revokeReason ?? '')}</td>
        <td>${escapar(data.certificates.find((p) => p.id === c.previousCertificateId)?.code ?? '—')}</td>
        <td>${c.status === 'ACTIVE' ? `<button class="row-action" data-cert-revoke="${c.id}">Anular</button>` : ''}${c.status !== 'REISSUED' && !data.certificates.some((n) => n.previousCertificateId === c.id) ? `<button class="row-action" data-cert-reissue="${c.id}">Reemitir</button>` : ''}</td></tr>`).join('') || empty(7, 'Sin certificados.')}
      </tbody></table></div>`)}
    ${history('Excepciones concedidas', `<p class="dialog-note">Vigentes, vencidas, consumidas y revocadas. Nunca se borran.</p><div class="table-wrap"><table><thead><tr><th>Acción</th><th>Actividad</th><th>Estado</th><th>Motivo</th><th>Vence</th><th>Creada por</th><th>Fecha</th><th></th></tr></thead><tbody>
      ${data.overrides.map((o) => `<tr><td>${escapar(ACTION_TEXT[o.action] ?? o.action)}${o.extraAttempts ? ` (+${o.extraAttempts})` : ''}</td><td>${escapar(o.activity.module.name)} · ${escapar(o.activity.title)}</td><td>${badge(o.state)}</td><td>${escapar(o.reason)}</td><td>${formatDate(o.expiresAt)}</td><td>${escapar(o.createdBy.nombreCompleto)}</td><td>${formatDate(o.createdAt)}</td>
        <td>${o.state === 'VIGENTE' ? `<button class="row-action" data-revoke="${o.id}">Revocar</button>` : ''}</td></tr>`).join('') || empty(8)}
      </tbody></table></div>`)}
    ${history('Últimas acciones de auditoría', `<ul class="audit-list">${data.audit.map((a) => `<li><strong>${escapar(a.action)}</strong> · ${escapar(a.actor.nombreCompleto)} · ${formatDate(a.createdAt)}${a.reason ? ` — ${escapar(a.reason)}` : ''}</li>`).join('') || '<li>Sin acciones registradas.</li>'}</ul>`)}`;

  const performanceRoot = view.querySelector<HTMLElement>('#advisor-performance-report');
  if (performanceRoot) void mountPerformanceReport(performanceRoot, userId);
  const collectionsRoot = view.querySelector<HTMLElement>('#advisor-collections-history');
  if (collectionsRoot) void mountCollectionsHistory(collectionsRoot, userId);
  const reload = rerender;
  view.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-reset-course]')) { await resetCourse(data.user, reload); return; }
    const welcome = target.closest<HTMLButtonElement>('[data-test-welcome]');
    if (welcome) {
      const done = welcome.dataset.done === 'true';
      welcome.disabled = true;
      await run(() => api(`/admin/advisors/${userId}/welcome/test-completion`, { method: 'PUT', body: JSON.stringify({ completed: !done }) }),
        done ? 'Bienvenida pendiente: al ingresar la verá de nuevo.' : 'Bienvenida completada: al ingresar va directo al aula.', reload);
      welcome.disabled = false;
      return;
    }
    const toggle = target.closest<HTMLButtonElement>('[data-test-toggle]');
    if (toggle) {
      // Dentro del resumen del módulo: que el clic no abra ni cierre la tarjeta.
      event.preventDefault();
      const done = toggle.dataset.done === 'true';
      if (done) {
        const ok = await askForm(`Vaciar «${toggle.dataset.name}»`, '<p class="dialog-note dialog-danger">Se borran el avance, los intentos, el sello y las excepciones de este módulo (y los certificados de la cuenta). Los demás módulos no cambian.</p>', { reason: false, submit: 'Vaciar módulo' });
        if (!ok) return;
      }
      toggle.disabled = true;
      await run(() => api(`/admin/advisors/${userId}/modules/${toggle.dataset.testToggle}/test-completion`, { method: 'PUT', body: JSON.stringify({ completed: !done }) }),
        done ? 'Módulo vaciado: queda listo para probarlo de cero.' : 'Módulo marcado como completado.', reload);
      toggle.disabled = false;
      return;
    }
    const reactivate = target.closest<HTMLButtonElement>('[data-reactivate]');
    const resetWait = target.closest<HTMLButtonElement>('[data-reset-wait]');
    const limit = target.closest<HTMLButtonElement>('[data-limit]');
    const revoke = target.closest<HTMLButtonElement>('[data-revoke]');
    const certRevoke = target.closest<HTMLButtonElement>('[data-cert-revoke]');
    const certReissue = target.closest<HTMLButtonElement>('[data-cert-reissue]');
    // Una clave por apertura del diálogo: si la solicitud se reintenta, no se duplica la excepción.
    const grant = (activityId: string, body: Record<string, unknown>) => api(`/admin/advisors/${userId}/activities/${activityId}/reactivate`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': crypto.randomUUID() } });
    if (reactivate) {
      const form = await askForm(`Reactivar "${reactivate.dataset.title}"`, `
        <p class="dialog-note">El asesor se quedó sin intentos. Se le concederán nuevos intentos y conserva los anteriores en el historial.</p>
        <label>Intentos que se conceden<input name="extraAttempts" type="number" min="1" max="10" value="1" required></label>`, { submit: 'Reactivar prueba' });
      if (form) await run(() => grant(reactivate.dataset.reactivate!, { action: 'REACTIVATE', reason: form.reason, extraAttempts: Number(form.extraAttempts || 1) }), 'Prueba reactivada.', reload);
    } else if (resetWait) {
      const form = await askForm(`Quitar la espera de "${resetWait.dataset.title}"`, '<p class="dialog-note">El asesor podrá reintentar de inmediato.</p>', { submit: 'Quitar espera' });
      if (form) await run(() => grant(resetWait.dataset.resetWait!, { action: 'RESET_WAIT', reason: form.reason }), 'Espera eliminada.', reload);
    } else if (limit) {
      const used = Number(limit.dataset.used);
      const form = await askForm(`Intentos de "${limit.dataset.title}"`, `
        <p class="dialog-note">Ya usó <strong>${used}</strong> intento(s). Los usados se conservan; el nuevo valor es el total permitido para este asesor.</p>
        <label>Intentos permitidos<input name="maxAttempts" type="number" min="1" max="50" required value="${escapar(limit.dataset.max)}"></label>
        ${limit.dataset.custom === 'true' ? '<label class="check-label"><input name="restore" type="checkbox" value="1"> Volver al valor que define la evaluación</label>' : ''}`, { submit: 'Guardar intentos' });
      if (form) await run(() => api(`/admin/advisors/${userId}/activities/${limit.dataset.limit}/attempt-limit`, { method: 'PUT', body: JSON.stringify({ maxAttempts: form.restore ? null : Number(form.maxAttempts), reason: form.reason }) }), 'Intentos actualizados.', reload);
    } else if (revoke) {
      const form = await askForm('Revocar excepción', '');
      if (form) await run(() => api(`/admin/overrides/${revoke.dataset.revoke}/revoke`, { method: 'POST', body: JSON.stringify(form) }), 'Excepción revocada.', reload);
    } else if (certRevoke) {
      const form = await askForm('Anular certificado', '');
      if (form) await run(() => api(`/admin/certificates/${certRevoke.dataset.certRevoke}/revoke`, { method: 'POST', body: JSON.stringify(form) }), 'Certificado anulado.', reload);
    } else if (certReissue) {
      const form = await askForm('Reemitir certificado', '<p class="dialog-note">Se crea un certificado nuevo enlazado con el anterior.</p>');
      if (form) await run(() => api(`/admin/certificates/${certReissue.dataset.certReissue}/reissue`, { method: 'POST', body: JSON.stringify(form) }), 'Certificado reemitido.', reload);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Módulos y actividades

type CatalogModule = { id: string; name: string; order: number; status: string; activities: { id: string; title: string; type: string; status: string; isRequired: boolean; evaluations: { version: number; minimumScore: string; maxAttempts: number; waitMinutes: number; status: string }[] }[] };

async function modulesSection(view: HTMLElement): Promise<void> {
  const { data } = await api<{ data: CatalogModule[] }>('/admin/modules');
  view.innerHTML = data.map((module) => `
    <section class="auth-card admin-card"><div class="section-title row-title"><div><h2>${String(module.order).padStart(2, '0')} · ${escapar(module.name)}</h2><p>${badge(module.status)}</p></div>
      ${module.status === 'ACTIVE' || module.status === 'INACTIVE' ? `<button class="row-action" data-module="${module.id}" data-next="${module.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}">${module.status === 'ACTIVE' ? 'Desactivar módulo' : 'Activar módulo'}</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Actividad</th><th>Tipo</th><th>Obligatoria</th><th>Estado</th><th>Evaluación vigente</th><th>Acciones</th></tr></thead><tbody>
      ${module.activities.map((activity) => {
        const evaluation = activity.evaluations[0];
        const graded = !UNGRADED_TYPES.has(activity.type);
        return `<tr><td>${escapar(activity.title)}</td><td>${escapar(activity.type)}</td><td>${activity.isRequired ? 'Sí' : 'No'}</td><td>${badge(activity.status)}</td>
          <td>${evaluation ? `v${evaluation.version}: mínimo ${escapar(evaluation.minimumScore)}, ${evaluation.maxAttempts} intentos, espera ${evaluation.waitMinutes} min (${escapar(text(evaluation.status))})` : graded ? 'Sin configurar' : '<span class="muted">No se califica</span>'}</td>
          <td><button class="row-action" data-activity="${activity.id}" data-next="${activity.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}">${activity.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}</button>
          ${graded ? `<button class="row-action" data-evaluation="${activity.id}">Configurar evaluación</button>` : ''}
          ${evaluation ? `<button class="row-action" data-attempts="${activity.id}" data-title="${escapar(activity.title)}" data-max="${evaluation.maxAttempts}" data-min="${escapar(evaluation.minimumScore)}" data-wait="${evaluation.waitMinutes}">Cambiar intentos</button>` : ''}</td></tr>`;
      }).join('') || empty(6, 'El estado de este módulo depende de los sellos.')}
      </tbody></table></div></section>`).join('');

  view.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const moduleButton = target.closest<HTMLButtonElement>('[data-module]');
    const activityButton = target.closest<HTMLButtonElement>('[data-activity]');
    const evaluationButton = target.closest<HTMLButtonElement>('[data-evaluation]');
    const attemptsButton = target.closest<HTMLButtonElement>('[data-attempts]');
    const reload = rerender;
    if (moduleButton || activityButton) {
      const button = (moduleButton ?? activityButton)!;
      const form = await askForm(button.dataset.next === 'INACTIVE' ? 'Desactivar globalmente' : 'Activar globalmente', '<p class="dialog-note">Desactivar impide nuevos accesos e intentos; el progreso y el historial se conservan.</p>');
      if (!form) return;
      const path = moduleButton ? `/admin/modules/${moduleButton.dataset.module}/status` : `/admin/activities/${activityButton!.dataset.activity}/status`;
      await run(() => api(path, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.next, reason: form.reason }) }), 'Estado actualizado.', reload);
    } else if (attemptsButton) {
      // Cambia los intentos de la actividad para todos los asesores: crea una versión nueva de la evaluación que
      // conserva la nota mínima y la configuración. Los cupos individuales fijados en la ficha del asesor mandan sobre este.
      const { attempts: activityId, title = '', max = '1', min = '0', wait = '0' } = attemptsButton.dataset;
      const form = await askForm(`Intentos de «${title}»`, `
        <p class="dialog-note">Hoy cada asesor tiene <strong>${escapar(max)}</strong> intento(s) en esta actividad. El cambio aplica a todos los asesores desde ahora; los intentos ya usados se conservan y quien tenga un cupo individual en su ficha conserva ese cupo.</p>
        <label>Intentos por asesor<input name="maxAttempts" type="number" min="1" max="20" required value="${escapar(max)}"></label>`);
      if (!form) return;
      await run(() => api(`/admin/activities/${activityId}/evaluations`, { method: 'POST', body: JSON.stringify({ minimumScore: Number(min), maxAttempts: Number(form.maxAttempts), waitMinutes: Number(wait), reason: form.reason }) }), 'Intentos actualizados para todos los asesores.', reload);
    } else if (evaluationButton) {
      const form = await askForm('Nueva versión de evaluación', `
        <label>Nota mínima (0–100)<input name="minimumScore" type="number" min="0" max="100" step="0.01" required value="70"></label>
        <label>Intentos máximos<input name="maxAttempts" type="number" min="1" max="20" required value="3"></label>
        <label>Espera entre intentos fallidos (minutos)<input name="waitMinutes" type="number" min="0" max="10080" required value="30"></label>
        <p class="dialog-note">Se crea una versión nueva; las anteriores se archivan y no se editan.</p>`);
      if (!form) return;
      await run(() => api(`/admin/activities/${evaluationButton.dataset.evaluation}/evaluations`, { method: 'POST', body: JSON.stringify({ minimumScore: Number(form.minimumScore), maxAttempts: Number(form.maxAttempts), waitMinutes: Number(form.waitMinutes), reason: form.reason }) }), 'Evaluación configurada.', reload);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Métricas

type Ratio = { value: string | null; sinDatos: boolean };
const pct = (ratio: Ratio) => (ratio.sinDatos ? 'Sin datos' : `${ratio.value} %`);

async function metricsSection(view: HTMLElement, query = new URLSearchParams({ limit: '20' })): Promise<void> {
  const { data } = await api<{ data: {
    activeAdvisors: number; overallProgress: Ratio; score: { average: Ratio }; attempts: { averagePerAdvisor: Ratio; total: number };
    approvalByModule: { moduleId: string; name: string; participants: number; passed: number; approval: Ratio }[];
    distribution: { moduleId: string; status: string; advisors: number }[];
    time: { byActivity: { title: string; attempts: number; avgSeconds: string | null; medianSeconds: string | null }[] };
    stalled: { days: number; count: number; items: { nombreCompleto: string; numeroDocumento: string; lastActivityAt: string }[] };
    typing: { results: number; sinDatos: boolean; avgWpm: string | null; avgCorrectCpm: string | null; avgAccuracy: string | null; avgErrors: string | null; approvalRate: Ratio };
    excel: { results: number; sinDatos: boolean; avgScore: Ratio; approvalRate: Ratio; steps: { questionId: string; lesson: string; attempts: number; correct: number; successRate: Ratio }[] };
    dictation: { results: number; sinDatos: boolean; avgScore: Ratio; avgWordMatch: Ratio; approvalRate: Ratio; topErrors: { category: string; rule: string; total: number }[] };
    reactivations: { total: number; byAction: { key: string; total: number }[]; byAdmin: { key: string; total: number }[]; nextAttemptPassRate: Ratio };
    location: { items: { nombreCompleto: string; numeroDocumento: string; estado: string; moduleName: string | null; moduleStatus: string | null; activityTitle: string | null; lastActivityAt: string | null }[] };
  } }>(`/admin/metrics/summary?${query}`);
  const statuses = ['AVAILABLE', 'IN_PROGRESS', 'PASSED', 'FAILED', 'BLOCKED', 'NOT_STARTED'];
  const minutes = (value: string | null) => (value === null ? '—' : `${(Number(value) / 60).toFixed(1)} min`);
  view.innerHTML = `
    <section class="auth-card admin-card"><form id="metrics-filter" class="filter-grid">
      <label class="inline-label">Desde<input type="date" name="from" value="${escapar(query.get('from'))}"></label>
      <label class="inline-label">Hasta<input type="date" name="to" value="${escapar(query.get('to'))}"></label>
      <label class="inline-label">Detenidos (días)<input type="number" name="days" min="1" max="365" value="${escapar(query.get('days') ?? '')}" placeholder="7"></label>
      <select name="advisorStatus" aria-label="Estado del asesor"><option value="">Todos los asesores</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option><option value="bloqueado">Bloqueados</option></select>
      <button type="submit">Aplicar</button></form></section>
    <div class="metric-cards">
      <div class="metric-card"><span>Asesores activos</span><strong>${data.activeAdvisors}</strong></div>
      <div class="metric-card"><span>Avance general</span><strong>${pct(data.overallProgress)}</strong></div>
      <div class="metric-card"><span>Calificación promedio</span><strong>${data.score.average.sinDatos ? 'Sin datos' : escapar(data.score.average.value)}</strong></div>
      <div class="metric-card"><span>Intentos por asesor</span><strong>${data.attempts.averagePerAdvisor.sinDatos ? 'Sin datos' : escapar(data.attempts.averagePerAdvisor.value)}</strong></div>
      <div class="metric-card"><span>Asesores detenidos (${data.stalled.days} días)</span><strong>${data.stalled.count}</strong></div>
      <div class="metric-card"><span>Reactivaciones</span><strong>${data.reactivations.total}</strong></div>
    </div>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Aprobación y distribución por módulo</h2></div></div>
      <div class="table-wrap"><table><thead><tr><th>Módulo</th><th>Participantes</th><th>Aprobados</th><th>Aprobación</th>${statuses.map((s) => `<th>${text(s)}</th>`).join('')}</tr></thead><tbody>
      ${data.approvalByModule.map((m) => `<tr><td>${escapar(m.name)}</td><td>${m.participants}</td><td>${m.passed}</td><td>${pct(m.approval)}</td>${statuses.map((s) => `<td>${data.distribution.find((d) => d.moduleId === m.moduleId && d.status === s)?.advisors ?? 0}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Ubicación actual de cada asesor</h2></div></div>
      <div class="table-wrap"><table><thead><tr><th>Asesor</th><th>Documento</th><th>Estado</th><th>Módulo actual</th><th>Avance</th><th>Actividad</th><th>Último avance</th></tr></thead><tbody>
      ${data.location.items.map((l) => `<tr><td>${escapar(l.nombreCompleto)}</td><td>${escapar(l.numeroDocumento)}</td><td>${escapar(l.estado)}</td><td>${escapar(l.moduleName ?? 'Ruta completada')}</td><td>${l.moduleStatus ? badge(l.moduleStatus) : '—'}</td><td>${escapar(l.activityTitle ?? '—')}</td><td>${formatDate(l.lastActivityAt)}</td></tr>`).join('') || empty(7)}
      </tbody></table></div></section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Asesores detenidos</h2><p>Sin avance en los últimos ${data.stalled.days} días.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Asesor</th><th>Documento</th><th>Último avance</th></tr></thead><tbody>
      ${data.stalled.items.map((s) => `<tr><td>${escapar(s.nombreCompleto)}</td><td>${escapar(s.numeroDocumento)}</td><td>${formatDate(s.lastActivityAt)}</td></tr>`).join('') || empty(3)}
      </tbody></table></div></section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Tiempo empleado por actividad</h2></div></div>
      <div class="table-wrap"><table><thead><tr><th>Actividad</th><th>Intentos</th><th>Promedio</th><th>Mediana</th></tr></thead><tbody>
      ${data.time.byActivity.map((t) => `<tr><td>${escapar(t.title)}</td><td>${t.attempts}</td><td>${minutes(t.avgSeconds)}</td><td>${minutes(t.medianSeconds)}</td></tr>`).join('') || empty(4, 'Sin datos.')}
      </tbody></table></div></section>
    <div class="metric-cards">
      <div class="metric-card"><span>Mecanografía: PPM promedio</span><strong>${data.typing.sinDatos ? 'Sin datos' : escapar(data.typing.avgWpm)}</strong></div>
      <div class="metric-card"><span>Caracteres correctos por minuto</span><strong>${data.typing.sinDatos ? 'Sin datos' : escapar(data.typing.avgCorrectCpm)}</strong></div>
      <div class="metric-card"><span>Aprobación en mecanografía</span><strong>${data.typing.sinDatos ? 'Sin datos' : pct(data.typing.approvalRate)}</strong></div>
      <div class="metric-card"><span>Nota promedio de Excel</span><strong>${data.excel.sinDatos ? 'Sin datos' : escapar(data.excel.avgScore.value)}</strong></div>
      <div class="metric-card"><span>Nota promedio del dictado</span><strong>${data.dictation.sinDatos ? 'Sin datos' : escapar(data.dictation.avgScore.value)}</strong></div>
      <div class="metric-card"><span>Precisión promedio</span><strong>${data.typing.sinDatos ? 'Sin datos' : `${escapar(data.typing.avgAccuracy)} %`}</strong></div>
      <div class="metric-card"><span>Errores promedio</span><strong>${data.typing.sinDatos ? 'Sin datos' : escapar(data.typing.avgErrors)}</strong></div>
      <div class="metric-card"><span>Aprobación tras reactivar</span><strong>${pct(data.reactivations.nextAttemptPassRate)}</strong></div>
    </div>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Ofimática: aciertos de Excel por paso</h2><p>Aprobación de la práctica: ${pct(data.excel.approvalRate)}.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Paso</th><th>Lección</th><th>Intentos</th><th>Aciertos</th><th>Tasa de acierto</th></tr></thead><tbody>
      ${data.excel.steps.map((step) => `<tr><td>${escapar(step.questionId)}</td><td>${escapar(step.lesson)}</td><td>${step.attempts}</td><td>${step.correct}</td><td>${pct(step.successRate)}</td></tr>`).join('') || empty(5, 'Sin datos.')}
      </tbody></table></div></section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Ofimática: errores más frecuentes del dictado</h2><p>Aprobación del dictado: ${pct(data.dictation.approvalRate)}.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Categoría</th><th>Regla</th><th>Veces</th></tr></thead><tbody>
      ${data.dictation.topErrors.map((error) => `<tr><td>${escapar(error.category)}</td><td>${escapar(error.rule)}</td><td>${error.total}</td></tr>`).join('') || empty(3, 'Sin datos.')}
      </tbody></table></div></section>
    <section class="auth-card admin-card"><div class="section-title"><div><h2>Reactivaciones</h2></div></div>
      <div class="split-lists"><ul class="audit-list">${data.reactivations.byAction.map((r) => `<li>${escapar(ACTION_TEXT[r.key] ?? r.key)}: <strong>${r.total}</strong></li>`).join('') || '<li>Sin datos.</li>'}</ul>
      <ul class="audit-list">${data.reactivations.byAdmin.map((r) => `<li>${escapar(r.key)}: <strong>${r.total}</strong></li>`).join('') || '<li>Sin datos.</li>'}</ul></div></section>`;
  const select = view.querySelector<HTMLSelectElement>('[name="advisorStatus"]')!;
  select.value = query.get('advisorStatus') ?? '';
  view.querySelector<HTMLFormElement>('#metrics-filter')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = new URLSearchParams([...new FormData(event.currentTarget as HTMLFormElement)].filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)]));
    next.set('limit', '20');
    void metricsSection(view, next).catch((error) => feedback((error as Error).message, true));
  });
}

// ---------------------------------------------------------------------------------------------
// Auditoría (solo lectura)

async function auditSection(view: HTMLElement): Promise<void> {
  view.innerHTML = `<section class="auth-card admin-card"><div class="section-title"><div><h2>Auditoría</h2><p>Registro de solo lectura de las acciones administrativas.</p></div></div>
    <form id="audit-filter" class="filter-grid">
      <input name="action" placeholder="Acción (ej. USER_STATUS_CHANGED)" aria-label="Acción">
      <input name="entityType" placeholder="Entidad (ej. Usuario)" aria-label="Entidad">
      <input name="entityId" placeholder="Id de la entidad" aria-label="Id">
      <label class="inline-label">Desde<input type="date" name="from"></label><label class="inline-label">Hasta<input type="date" name="to"></label>
      <button type="submit">Filtrar</button></form>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Motivo</th></tr></thead><tbody id="audit-rows"></tbody></table></div>
    <div class="pagination"><button id="audit-more" type="button" hidden>Cargar más</button></div></section>`;
  const rows = view.querySelector('#audit-rows')!;
  const more = view.querySelector<HTMLButtonElement>('#audit-more')!;
  let cursor: string | null = null;
  let filters = new URLSearchParams();
  async function load(reset: boolean): Promise<void> {
    if (reset) { cursor = null; rows.innerHTML = ''; }
    const query = new URLSearchParams(filters);
    query.set('limit', '30');
    if (cursor) query.set('cursor', cursor);
    const page = await api<Page<{ createdAt: string; action: string; entityType: string; entityId: string; reason: string | null; actor: { nombreCompleto: string } }>>(`/admin/audit?${query}`);
    rows.insertAdjacentHTML('beforeend', page.data.map((a) => `<tr><td>${formatDate(a.createdAt)}</td><td>${escapar(a.actor.nombreCompleto)}</td><td>${escapar(a.action)}</td><td>${escapar(a.entityType)} <small>${escapar(a.entityId.slice(0, 8))}</small></td><td>${escapar(a.reason ?? '')}</td></tr>`).join('') || (reset ? empty(5) : ''));
    cursor = page.meta.nextCursor;
    more.hidden = !cursor;
  }
  view.querySelector<HTMLFormElement>('#audit-filter')!.addEventListener('submit', (event) => {
    event.preventDefault();
    filters = new URLSearchParams([...new FormData(event.currentTarget as HTMLFormElement)].filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)]));
    void load(true).catch((error) => feedback((error as Error).message, true));
  });
  more.addEventListener('click', () => void load(false).catch((error) => feedback((error as Error).message, true)));
  await load(true);
}

// ---------------------------------------------------------------------------------------------

const SECTIONS = [
  { hash: '#asesores', label: 'Asesores' },
  { hash: '#validacion', label: 'Validación y certificaciones' },
  { hash: '#modulos', label: 'Módulos y actividades' },
  { hash: '#ofimatica', label: 'Ofimática' },
  { hash: '#metricas', label: 'Métricas' },
  { hash: '#auditoria', label: 'Auditoría' },
];

export function renderAdmin(shell: Shell): void {
  shell('Panel de administración', 'Gestiona asesores, la ruta de formación y su seguimiento.', `
    <div class="admin-layout"><aside class="admin-nav"><strong>Administración</strong>
      ${SECTIONS.map((section) => `<a href="${section.hash}" data-nav="${section.hash}">${section.label}</a>`).join('')}
      <p>Toda acción que modifica datos pide un motivo y queda en auditoría.</p></aside>
    <div class="admin-content"><p id="admin-feedback" class="feedback" role="status" hidden></p><div id="admin-view"></div></div></div>
    <dialog id="admin-dialog" class="edit-dialog"></dialog>
    <div id="admin-busy" class="admin-busy" role="status" aria-live="polite" hidden><div><span class="admin-spinner" aria-hidden="true"></span><p>Guardando cambios…</p></div></div>`);

  // Pinta la sección que corresponde al hash dentro de `view`.
  async function renderInto(view: HTMLElement, hash: string): Promise<void> {
    if (hash.startsWith('#ficha/')) await advisorFileSection(view, hash.slice('#ficha/'.length));
    else if (hash.startsWith('#validacion') || hash.startsWith('#expediente/')) await certificationSection(view, hash, { askForm, run, feedback, rerender, empty });
    else if (hash === '#modulos') await modulesSection(view);
    else if (hash === '#ofimatica') await officeSection(view, { askForm, run, feedback, rerender, badge, empty });
    else if (hash === '#metricas') await metricsSection(view);
    else if (hash === '#auditoria') await auditSection(view);
    else await advisorsSection(view);
  }

  async function route(): Promise<void> {
    const hash = location.hash || '#asesores';
    document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((link) => link.classList.toggle('selected', hash.startsWith(link.dataset.nav!) || (hash.startsWith('#ficha') && link.dataset.nav === '#asesores') || (hash.startsWith('#expediente') && link.dataset.nav === '#validacion')));
    const old = document.querySelector<HTMLElement>('#admin-view')!;
    const view = old.cloneNode(false) as HTMLElement; // descarta escuchadores de la sección anterior
    old.replaceWith(view);
    view.innerHTML = '<p class="loading-note">Cargando…</p>';
    document.querySelector<HTMLElement>('#admin-feedback')!.hidden = true;
    try {
      await renderInto(view, hash);
    } catch (error) {
      view.innerHTML = '';
      feedback((error as Error).message, true);
    }
  }

  // Actualización en vivo: vuelve a pintar la sección en segundo plano y cambia una por otra cuando está lista, sin el
  // aviso de «Cargando…», conservando el desplazamiento y los detalles que el administrador tenga abiertos.
  let refreshing = false;
  async function liveRefresh(): Promise<void> {
    const hash = location.hash || '#asesores';
    const old = document.querySelector<HTMLElement>('#admin-view');
    if (!old || hash.startsWith('#auditoria') || refreshing) return;
    const active = document.activeElement as HTMLElement | null;
    const editing = Boolean(active && old.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    if (document.querySelector<HTMLDialogElement>('#admin-dialog')?.open || !document.querySelector<HTMLElement>('#admin-busy')!.hidden || editing) { scheduleLive(5000); return; }
    refreshing = true;
    const fresh = old.cloneNode(false) as HTMLElement;
    fresh.hidden = true;
    old.after(fresh);
    const opened = [...old.querySelectorAll('details')].map((details) => details.open);
    const scroll = window.scrollY;
    try {
      await renderInto(fresh, hash);
      if ((location.hash || '#asesores') === hash) {
        old.remove();
        fresh.hidden = false;
        fresh.querySelectorAll('details').forEach((details, index) => { if (opened[index]) details.open = true; });
        window.scrollTo(0, scroll);
      } else fresh.remove();
    } catch {
      fresh.remove(); // un fallo de red no borra lo que el administrador está viendo
    } finally { refreshing = false; }
  }
  let liveTimer: number | undefined;
  function scheduleLive(delay = 600): void {
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => void liveRefresh(), delay);
  }

  // Canal WebSocket: el servidor avisa cada cambio de datos. Si se cae, reintenta y mientras tanto consulta cada 30 s.
  const liveBadge = document.createElement('p');
  liveBadge.className = 'admin-live';
  liveBadge.setAttribute('role', 'status');
  document.querySelector('.admin-nav')?.append(liveBadge);
  let retries = 0;
  let fallback: number | undefined;
  function setLive(connected: boolean): void {
    liveBadge.dataset.state = connected ? 'on' : 'off';
    liveBadge.textContent = connected ? '● En vivo con la base de datos' : '○ Reconectando…';
  }
  function connectLive(): void {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
    socket.addEventListener('open', () => { retries = 0; window.clearInterval(fallback); setLive(true); scheduleLive(100); });
    socket.addEventListener('message', (event) => {
      try { if ((JSON.parse(String(event.data)) as { type?: string }).type === 'change') scheduleLive(); } catch { /* mensaje ajeno */ }
    });
    socket.addEventListener('close', () => {
      setLive(false);
      window.clearInterval(fallback);
      fallback = window.setInterval(() => scheduleLive(100), 30_000);
      window.setTimeout(connectLive, Math.min(30_000, 1000 * 2 ** retries++));
    });
  }
  setLive(false);
  connectLive();
  currentRoute = route;
  window.addEventListener('hashchange', () => void route());
  void route();
}
