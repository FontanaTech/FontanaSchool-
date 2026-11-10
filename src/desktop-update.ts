// Botón «Buscar actualizaciones» del inicio de sesión. Solo existe en la aplicación de escritorio (Electron), que
// expone window.fontanaDesktop; en el navegador no aparece nada.
import { escapar as text } from './http';

type Manifest = { tag: string; commit: string; version: string; builtAt: string } | null;
type Check = { available: boolean; current: Manifest; message?: string; latest?: { tag: string; name: string; publishedAt: string; notes: string; size: number } };
type Desktop = {
  info(): Promise<{ appVersion: string; runtime: Manifest; updated?: { tag: string; at: string } | null }>;
  checkUpdate(): Promise<Check>;
  applyUpdate(): Promise<{ ok: boolean; tag: string }>;
  onProgress(callback: (data: { stage: string; percent: number }) => void): () => void;
};

const desktop = (): Desktop | undefined => (window as unknown as { fontanaDesktop?: Desktop }).fontanaDesktop;
const date = (iso: string | undefined): string => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function mountDesktopUpdate(card: HTMLElement): void {
  const api = desktop();
  if (!api) return;
  const box = document.createElement('div');
  box.className = 'desktop-update';
  box.innerHTML = `<button type="button" class="desktop-update__button">⟳ Buscar actualizaciones</button>
    <p class="desktop-update__status" role="status" aria-live="polite"></p>`;
  card.append(box);
  const button = box.querySelector<HTMLButtonElement>('button')!;
  const status = box.querySelector<HTMLElement>('.desktop-update__status')!;
  void api.info().then(({ runtime, updated }) => {
    const installed = runtime ? `Versión instalada: ${date(runtime.builtAt)}` : '';
    // Tras reiniciarse por una actualización, la aplicación lo confirma una vez.
    status.textContent = updated ? `✔ Actualización correcta. ${installed}` : installed;
  }).catch(() => undefined);

  let pending: Check | null = null;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (!pending?.available) {
        status.textContent = 'Buscando la última versión publicada…';
        pending = await api.checkUpdate();
        if (!pending.available) {
          status.textContent = pending.message ?? `Ya tienes la última versión (${date(pending.current?.builtAt)}).`;
          return;
        }
        const notes = pending.latest!.notes.split('\n').filter(Boolean).slice(-1)[0] ?? '';
        status.innerHTML = `Hay una versión nueva del ${text(date(pending.latest!.publishedAt))}${notes ? `: ${text(notes)}` : ''}.`;
        button.textContent = `⬇ Descargar e instalar (${Math.round(pending.latest!.size / 1024 / 1024)} MB)`;
        return;
      }
      const stop = api.onProgress(({ stage, percent }) => { status.textContent = `${stage} ${percent ? `${percent} %` : ''}`; });
      try { await api.applyUpdate(); } finally { stop(); }
      status.textContent = '✔ Actualización correcta. Reiniciando la aplicación…';
    } catch (error) {
      status.textContent = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      button.disabled = false;
    }
  });
}
