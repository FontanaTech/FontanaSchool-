import { api, escapar } from './http';
import { pasosCamino } from './learning-path';
import { revealApp, showAppLoading } from './loading';
import { BANCOS, SEXOS, TALLAS_CAMISA, TIPOS_DOCUMENTO, TIPOS_SANGRE, type DatosPersonales } from '../server/domain/profile';

type Usuario = Partial<Omit<DatosPersonales, 'fechaNacimiento'>> & {
  fechaNacimiento?: string | null;
  id: string;
  nombreCompleto: string;
  numeroDocumento: string;
  rol: string;
  estado: string;
  correo: string | null;
  telefono: string | null;
  tipoDocumento: string;
  debeCompletarDatos: boolean;
  debeCambiarPassword: boolean;
  tieneExperienciaCobranzasDigitales: boolean | null;
  historiaCompletada: boolean;
  metodoCompletado: boolean;
  ruta: string;
};

function mensaje(texto: string, error = false): void {
  const target = document.querySelector<HTMLElement>('#feedback');
  if (!target) return;
  target.textContent = texto;
  target.className = `feedback ${error ? 'feedback-error' : 'feedback-ok'}`;
  target.hidden = false;
}

function shell(title: string, subtitle: string, content: string, usuario?: Usuario): void {
  document.body.className = 'auth-screen';
  document.querySelector<HTMLElement>('#app-content')!.innerHTML = `
    <header class="auth-header">
      <a class="auth-brand" href="/"><img src="/imagenes/fontana-logo.webp" alt=""><span>FONTANA <small>SCHOOL</small></span></a>
      ${usuario ? `<div class="auth-account"><span>${escapar(usuario.nombreCompleto)}</span><button type="button" id="logout" class="text-button">Cerrar sesión</button></div>` : ''}
    </header>
    <main class="auth-main">${title || subtitle ? `<div class="auth-intro"><p class="auth-kicker">FONTANA SCHOOL</p><h1>${title}</h1><p>${subtitle}</p></div>` : ''}${content}</main>
  `;
  document.body.hidden = false;
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.assign('/login');
  });
}

// Identidad compartida por el acceso y el formulario del primer ingreso.
function aplicarEstiloAcceso(): void {
  document.body.classList.add('auth-login', 'login-motion');
  document.querySelector('.auth-intro')?.remove();
  document.querySelector('.auth-brand')!.innerHTML = '<img src="/imagenes/fontana-logo.webp" alt="Fontana"><span>Aula de formación</span>';
}

function formularioLogin(): void {
  shell('', '', `
    <div class="login-panel">
    <section class="login-welcome" aria-label="Bienvenida a Fontana">
      <svg class="login-brand-curves" viewBox="0 0 680 480" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="login-curve-gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#d4af37" stop-opacity=".08"/>
            <stop offset=".4" stop-color="#f4d98c" stop-opacity=".75"/>
            <stop offset=".7" stop-color="#d4af37" stop-opacity=".5"/>
            <stop offset="1" stop-color="#f4d98c" stop-opacity=".08"/>
          </linearGradient>
        </defs>
        <path class="login-curve-ribbon" d="M-80 310 Q300 600 760 295 L760 334 Q300 615-80 338Z"/>
        <g fill="none" stroke="url(#login-curve-gold)">
          <path d="M-80-65 Q340 270 760-65"/>
          <path class="login-curve-faint" d="M-80-52 Q340 290 760-52"/>
          <path d="M-80 310 Q300 600 760 295"/>
          <path class="login-curve-faint" d="M-80 338 Q300 615 760 334"/>
          <path d="M-80 354 Q360 650 760 345"/>
        </g>
      </svg>
      <div class="login-aula-brand">
        <img src="/imagenes/fontana-logo.webp" alt="Fontana" width="220" height="220">
        <span>Aula De Formación</span>
      </div>
    </section>
    <section class="auth-card narrow login-card" aria-labelledby="login-title">
      <h1 id="login-title">Inicia tu sesión</h1>
      <div class="role-tabs" role="tablist" aria-label="Tipo de acceso">
        <button type="button" class="role-tab active" data-role="asesor" aria-selected="true">Soy asesor</button>
        <button type="button" class="role-tab" data-role="administrador" aria-selected="false">Administración</button>
      </div>
      <form id="login-form" class="auth-form">
        <input type="hidden" name="tipo" value="asesor">
        <label><span id="identity-label">Número de documento</span><input name="identificador" required autocomplete="username" maxlength="150" placeholder="Escribe tu documento"></label>
        <p id="advisor-access-note" class="login-access-note">Tu acceso es con el número de documento registrado. No necesitas contraseña.</p>
        <div class="password-field" id="password-field" hidden>
          <label for="login-password">Contraseña</label>
          <div class="password-control">
            <input id="login-password" name="password" type="password" disabled autocomplete="current-password" placeholder="Escribe tu contraseña">
            <button class="password-toggle" type="button" aria-label="Mostrar contraseña" aria-pressed="false" aria-controls="login-password">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="M3 3l18 18"/></svg>
            </button>
          </div>
        </div>
        <button class="primary-action" type="submit"><span class="login-submit-label" aria-live="polite">Ingresar</span><span class="login-submit-arrow" aria-hidden="true">→</span><span class="login-spinner" aria-hidden="true" hidden></span></button>
        <p id="feedback" class="feedback" role="alert" hidden></p>
      </form>
    </section></div>`);
  aplicarEstiloAcceso();
  document.body.classList.add('auth-login-entry');
  document.querySelector('.auth-header')!.remove();
  // Aplicación de escritorio: botón para traer la última versión publicada desde main.
  void import('./desktop-update').then(({ mountDesktopUpdate }) => mountDesktopUpdate(document.querySelector<HTMLElement>('.login-card')!));
  const form = document.querySelector<HTMLFormElement>('#login-form')!;
  const passwordInput = form.elements.namedItem('password') as HTMLInputElement;
  const passwordToggle = form.querySelector<HTMLButtonElement>('.password-toggle')!;
  passwordToggle.addEventListener('click', () => {
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
  let submitting = false;
  function setSubmitting(busy: boolean): void {
    submitting = busy;
    form.setAttribute('aria-busy', String(busy));
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = busy;
    form.querySelector('.login-submit-label')!.textContent = busy ? 'Ingresando…' : 'Ingresar';
    form.querySelector<HTMLElement>('.login-submit-arrow')!.hidden = busy;
    form.querySelector<HTMLElement>('.login-spinner')!.hidden = !busy;
    document.querySelectorAll<HTMLButtonElement>('.role-tab').forEach((tab) => { tab.disabled = busy; });
  }
  document.querySelectorAll<HTMLButtonElement>('.role-tab').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('.role-tab').forEach((tab) => {
      tab.classList.toggle('active', tab === button);
      tab.setAttribute('aria-selected', String(tab === button));
    });
    (form.elements.namedItem('tipo') as HTMLInputElement).value = button.dataset.role!;
    const advisor = button.dataset.role === 'asesor';
    // El asesor entra solo con su documento: el campo de contraseña se oculta y no se envía.
    form.querySelector<HTMLElement>('#password-field')!.hidden = advisor;
    form.querySelector<HTMLElement>('#advisor-access-note')!.hidden = !advisor;
    passwordInput.disabled = advisor;
    passwordInput.required = !advisor;
    if (advisor) { passwordInput.value = ''; passwordInput.type = 'password'; }
    document.querySelector('#identity-label')!.textContent = button.dataset.role === 'asesor' ? 'Número de documento' : 'Documento o correo administrativo';
    (form.elements.namedItem('identificador') as HTMLInputElement).placeholder = button.dataset.role === 'asesor' ? 'Escribe tu documento' : 'Documento o correo';
  }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const data = Object.fromEntries(new FormData(form));
    setSubmitting(true);
    document.querySelector<HTMLElement>('#feedback')!.hidden = true;
    try {
      const result = await api<{ usuario: Usuario }>('/auth/login', { method: 'POST', body: JSON.stringify(data) });
      showAppLoading('Iniciando tu sesión…');
      location.assign(result.usuario.ruta);
    } catch (error) { mensaje((error as Error).message, true); setSubmitting(false); }
  });
}

function llenaTusDatos(usuario: Usuario): void {
  const input = (label: string, name: string, value: string | null | undefined, attributes: string) =>
    `<label>${label}<input name="${name}" value="${escapar(value)}" ${attributes}></label>`;
  const select = (label: string, name: string, options: readonly string[], selected?: string | null) =>
    `<label>${label}<select name="${name}" required><option value="">Selecciona una opción</option>${options.map((value) => `<option value="${escapar(value)}"${value === selected ? ' selected' : ''}>${value === 'PPT' ? 'Permiso de permanencia de trabajo' : escapar(value)}</option>`).join('')}</select></label>`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  shell('', '', `
    <div class="login-panel">
      <section class="auth-card narrow login-card" aria-labelledby="profile-title">
      <h1 id="profile-title">Completa tus datos</h1>
      <p class="profile-intro">Un último paso antes de comenzar tu inducción.</p>
      <div class="profile-summary"><strong>${escapar(usuario.nombreCompleto)}</strong><span>Documento ${escapar(usuario.numeroDocumento)}</span></div>
      <form id="profile-form" class="auth-form">
        <p class="profile-required">Todos los campos son obligatorios, excepto el teléfono personal.</p>
        <fieldset class="profile-fields"><legend>Datos personales</legend><div class="profile-grid">
          ${input('Nombre', 'nombre', usuario.nombre, 'required maxlength="75" autocomplete="given-name"')}
          ${input('Apellidos', 'apellidos', usuario.apellidos, 'required maxlength="75" autocomplete="family-name"')}
          ${select('Tipo de documento', 'tipoDocumento', TIPOS_DOCUMENTO, usuario.tipoDocumento)}
          ${input('Número de documento', 'numeroDocumento', usuario.numeroDocumento, 'required maxlength="30" inputmode="numeric" pattern="[0-9]+"')}
          ${input('Fecha de nacimiento', 'fechaNacimiento', usuario.fechaNacimiento, `type="date" required max="${today}" autocomplete="bday"`)}
          ${select('Sexo', 'sexo', SEXOS, usuario.sexo)}
          ${select('Tipo de sangre', 'tipoSangre', TIPOS_SANGRE, usuario.tipoSangre)}
          ${select('Talla de camisa', 'tallaCamisa', TALLAS_CAMISA, usuario.tallaCamisa)}
        </div></fieldset>
        <fieldset class="profile-fields"><legend>Datos de contacto</legend><div class="profile-grid">
          <div class="profile-full">${input('Dirección de residencia', 'direccionResidencia', usuario.direccionResidencia, 'required maxlength="250" autocomplete="street-address"')}</div>
          ${input('Correo electrónico', 'correo', usuario.correo, 'type="email" required maxlength="150" autocomplete="email" placeholder="nombre@empresa.com"')}
          ${input('Teléfono <small>Opcional</small>', 'telefono', usuario.telefono, 'type="tel" maxlength="30" autocomplete="tel"')}
        </div></fieldset>
        <fieldset class="profile-fields"><legend>Contacto de emergencia</legend><div class="profile-grid">
          ${input('Nombre del contacto de emergencia', 'nombreContactoEmergencia', usuario.nombreContactoEmergencia, 'required maxlength="150"')}
          ${input('Número del contacto de emergencia', 'numeroContactoEmergencia', usuario.numeroContactoEmergencia, 'type="tel" required maxlength="30"')}
        </div></fieldset>
        <fieldset class="profile-fields"><legend>Datos bancarios</legend><div class="profile-grid">
          ${select('Banco', 'banco', BANCOS, usuario.banco)}
          ${input('Número de cuenta', 'numeroCuenta', usuario.numeroCuenta, 'required maxlength="30" inputmode="numeric" pattern="[0-9]+" autocomplete="off"')}
          <div id="other-bank-field" class="profile-full" hidden>${input('Nombre del otro banco', 'otroBanco', usuario.otroBanco, 'maxlength="100" disabled')}</div>
        </div></fieldset>
        <button class="primary-action" type="submit">Guardar y continuar</button><p id="feedback" class="feedback" role="alert" hidden></p>
      </form>
      <button type="button" class="profile-back" id="profile-back-login">← Volver al inicio de sesión</button>
    </section></div>`, usuario);
  aplicarEstiloAcceso();
  document.body.classList.add('auth-profile');
  document.querySelector('.auth-account')?.remove();
  const profileForm = document.querySelector<HTMLFormElement>('#profile-form')!;
  const draftKey = `fontana-profile-draft:${usuario.id}`;
  const correoInput = profileForm.elements.namedItem('correo') as HTMLInputElement;
  const telefonoInput = profileForm.elements.namedItem('telefono') as HTMLInputElement;
  const bank = profileForm.elements.namedItem('banco') as HTMLSelectElement;
  const otherBank = profileForm.elements.namedItem('otroBanco') as HTMLInputElement;
  const updateBank = () => {
    const other = bank.value === 'Otros';
    document.querySelector<HTMLElement>('#other-bank-field')!.hidden = !other;
    otherBank.disabled = !other;
    otherBank.required = other;
  };
  bank.addEventListener('change', updateBank);
  updateBank();
  const backToLogin = document.querySelector<HTMLButtonElement>('#profile-back-login')!;
  backToLogin.addEventListener('click', async () => {
    if (backToLogin.disabled) return;
    backToLogin.disabled = true;
    backToLogin.textContent = 'Cerrando sesión…';
    try {
      await api('/auth/logout', { method: 'POST' });
      showAppLoading('Volviendo al inicio de sesión…');
      location.replace('/login');
    } catch (error) {
      mensaje((error as Error).message, true);
      backToLogin.disabled = false;
      backToLogin.textContent = '← Volver al inicio de sesión';
    }
  });
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as { correo?: unknown; telefono?: unknown } | null;
    if (typeof draft?.correo === 'string') correoInput.value = draft.correo;
    if (typeof draft?.telefono === 'string') telefonoInput.value = draft.telefono;
  } catch { /* El formulario sigue funcionando si el navegador bloquea el almacenamiento. */ }
  const correo = document.querySelector<HTMLInputElement>('[name="correo"]')!;
  correo.addEventListener('input', () => {
    correo.setCustomValidity(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.value.trim())
      ? '' : 'Ingresa un correo válido con @ y dominio, por ejemplo nombre@empresa.com.');
  });
  correo.addEventListener('invalid', () => {
    correo.setCustomValidity('Ingresa un correo válido con @ y dominio, por ejemplo nombre@empresa.com.');
  });
  let savingProfile = false;
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (savingProfile || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    savingProfile = true;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.disabled = true;
    submit.textContent = 'Guardando tus datos…';
    backToLogin.disabled = true;
    document.querySelector<HTMLElement>('#feedback')!.hidden = true;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ correo: data.correo, telefono: data.telefono }));
    } catch { /* Guardar el perfil no depende del almacenamiento del navegador. */ }
    try {
      const result = await api<{ usuario: Usuario }>('/auth/completar-datos', {
        method: 'POST', body: JSON.stringify(data),
      });
      try { sessionStorage.removeItem(draftKey); } catch { /* Sin almacenamiento disponible. */ }
      location.assign(result.usuario.ruta);
    } catch (error) {
      mensaje((error as Error).message, true);
      savingProfile = false;
      submit.disabled = false;
      submit.textContent = 'Guardar y continuar';
      backToLogin.disabled = false;
    }
  });
}

async function admin(usuario: Usuario): Promise<void> {
  const { renderAdmin } = await import('./admin/admin');
  renderAdmin((title, subtitle, content) => shell(title, subtitle, content, usuario));
}

export async function iniciarInterfaz(): Promise<void> {
  let usuario: Usuario | null = null;
  try { usuario = (await api<{ usuario: Usuario }>('/auth/me')).usuario; } catch { /* Sin sesión. */ }
  if (!usuario) { formularioLogin(); await revealApp(); return; }
  const route = usuario.ruta;
  const practiceRoute = route === '/practica' || route === '/practica/nuevo' || route === '/practica/experiencia';
  const reviewing = practiceRoute && location.pathname === '/induccion';
  // Subrutas de la ruta de formación: el servidor valida el acceso a cada módulo.
  // Módulo 1 (Ofimática para tus cobranzas): tiene su propia aplicación con cinco secciones.
  const officeMatch = /^\/induccion\/modulos\/ofimatica-mecanografia(?:\/(bienvenida|mecanografia|excel|ortografia|resultado))?\/?$/.exec(location.pathname);
  const officeRoute = Boolean(officeMatch) && (route === '/induccion' || practiceRoute);
  const advisorSubroute = !officeRoute && (route === '/induccion' || practiceRoute) && /^\/induccion\/(modulos\/[a-z0-9-]+|certificado|bienvenida-equipo)\/?$/.test(location.pathname);
  if (location.pathname !== route && location.pathname !== '/app' && !reviewing && !advisorSubroute && !officeRoute) { location.replace(route); return; }
  if (route === '/admin') { await admin(usuario); await revealApp(); return; }
  if (route === '/llena-tus-datos') { llenaTusDatos(usuario); await revealApp(); return; }
  // Asesor con el perfil completo: vigilamos la reactivación de Karol para llevarlo solo a la actividad que reactive.
  void import('./reactivation-watch').then(({ startReactivationWatch }) => startReactivationWatch());
  if (officeRoute) {
    const { mountOffice } = await import('./office/office');
    await mountOffice(usuario.nombreCompleto, (officeMatch![1] as import('./office/api').SectionKey | undefined) ?? null, route);
    await revealApp();
    return;
  }
  if (advisorSubroute) {
    shell('', '', '<div id="module-page"></div>', usuario);
    const { renderModulePage } = await import('./advisor/advisor');
    await renderModulePage(document.querySelector<HTMLElement>('#module-page')!, practiceRoute ? route : '/induccion', usuario.tieneExperienciaCobranzasDigitales);
    await revealApp();
    return;
  }
  if (practiceRoute && !reviewing) {
    // Los dos módulos se descargan a la vez en lugar de uno tras otro.
    const [{ mostrarPractica }, { mountLearningPath }] = await Promise.all([import('./practice'), import('./advisor/advisor')]);
    mostrarPractica(usuario.nombreCompleto, route);
    await mountLearningPath();
    await revealApp();
    return;
  }
  if (location.pathname !== route && !reviewing) { location.replace(route); return; }
  const { mountHeaderAccount } = await import('./header-account');
  mountHeaderAccount(usuario.nombreCompleto, 'Inducción Fontana');
  // "Tu camino en Fontana": con la práctica ya asignada, el paso 02 lleva de vuelta a ella.
  document.querySelector('.learning-path ol')!.outerHTML = pasosCamino('empresa', practiceRoute ? route : null);
  const { restoreProgress } = await import('./training');
  restoreProgress({ historia: usuario.historiaCompletada, metodo: usuario.metodoCompletado, completada: practiceRoute });
  // Bienvenida ya completada: botón destacado para seguir al aula de formación.
  if (practiceRoute) {
    document.querySelector<HTMLAnchorElement>('#welcome-continue-link')!.href = route;
    document.querySelector<HTMLElement>('#welcome-continue')!.hidden = false;
  }
  await revealApp();
}
