// Nombre del asesor y «Cerrar sesión» dentro del encabezado vino de la inducción, la práctica y Ofimática.
// Reemplaza la antigua barra azul superior.
import { escapar as escapeHtml } from './http';

export function mountHeaderAccount(nombre: string, contexto: string): void {
  const header = document.querySelector<HTMLElement>('#app-content header:not(.auth-header)');
  if (!header || header.querySelector('.header-account')) return;
  header.insertAdjacentHTML('beforeend', `
    <div class="header-account">
      <span class="header-account-name">${escapeHtml(nombre)}<small>${escapeHtml(contexto)}</small></span>
      <button type="button" class="header-logout">Cerrar sesión</button>
    </div>`);
  const logout = header.querySelector<HTMLButtonElement>('.header-logout')!;
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    logout.textContent = 'Cerrando…';
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('No se pudo cerrar la sesión.');
      location.assign('/login');
    } catch {
      logout.disabled = false;
      logout.textContent = 'Reintentar cerrar sesión';
    }
  });
}
