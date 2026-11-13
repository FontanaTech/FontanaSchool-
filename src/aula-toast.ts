import './aula-toast.css';

// Aviso breve del aula, anunciado por lectores de pantalla. Se muestra, se mantiene un momento y desaparece solo.
// `showAulaToast` resuelve a los `holdMs` para poder encadenar una navegación justo después de que el asesor lo vea.

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.className = 'aula-toasts';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.append(region);
  return region;
}

export function showAulaToast(message: string, { holdMs = 1300, totalMs = 3600 }: { holdMs?: number; totalMs?: number } = {}): Promise<void> {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const host = ensureRegion();
  const item = document.createElement('div');
  item.className = 'aula-toast';
  item.innerHTML = '<span class="aula-toast__dot" aria-hidden="true"></span><span class="aula-toast__text"></span>';
  item.querySelector<HTMLElement>('.aula-toast__text')!.textContent = message;
  host.append(item);
  requestAnimationFrame(() => item.classList.add('is-visible'));
  // Si el asesor navega al apartado reactivado, la página se descarga antes de este retiro; no pasa nada.
  window.setTimeout(() => {
    item.classList.remove('is-visible');
    window.setTimeout(() => item.remove(), reduced ? 0 : 300);
  }, totalMs);
  return new Promise((resolve) => window.setTimeout(resolve, holdMs));
}
