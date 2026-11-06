import './company-life.css';
import { parseLifeItems, type LifeItem } from './company-life-model';

const svg = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const playIcon = svg('<path d="m8 5 11 7-11 7V5Z"/>');
const checkIcon = svg('<path d="M20 6 9 17l-5-5"/>');
const prevIcon = svg('<path d="m15 5-7 7 7 7"/>');
const nextIcon = svg('<path d="m9 5 7 7-7 7"/>');

const COVER = '/vida-fontana/portada.webp';
// Cada cuánto avanza solo (ms). No se usa con movimiento reducido (ahí se navega con las flechas).
const INTERVAL = 4500;

type Described = { eyebrow: string; title: string; person: string; desc: string; kind: string };

/**
 * Descompone el nombre guardado (sin tocar los archivos) en: etiqueta de piso, nombre limpio del lugar y,
 * cuando corresponde, la persona. Quita la repetición del piso solo en la presentación.
 *   «Piso 10 Zona de trabajo»            → PISO 10 · «Zona de trabajo»
 *   «Oficina Jefe Alexander Arango Piso 11» → PISO 11 · «Oficina» · persona «Jefe Alexander Arango»
 *   «Almuerzos fin de mes» (momento)     → NUESTRO ÁLBUM · «Almuerzos fin de mes»
 */
function describe(item: LifeItem): Described {
  const raw = item.title.trim();
  const fm = /piso\s*(\d+)/i.exec(raw);
  if (!fm) return { eyebrow: 'Nuestro álbum', title: raw, person: '', desc: item.caption || '', kind: 'Momento' };
  let t = raw.replace(/\s*piso\s*\d+\s*/i, ' ').replace(/\s{2,}/g, ' ').replace(/^[-–·\s]+|[-–·\s]+$/g, '').trim();
  let person = '';
  const om = /^oficina\b\s*(.*)$/i.exec(t);
  if (om) { person = om[1].trim(); t = 'Oficina'; }
  // Presentación: separa segmentos unidos por guion y pasa el lugar a mayúscula inicial (no hay nombres propios aquí).
  const clean = t.split(/\s*[-–]\s*/).map((seg) => { const w = seg.trim().toLowerCase(); return w ? w[0]!.toUpperCase() + w.slice(1) : w; }).filter(Boolean).join(' · ');
  return { eyebrow: `Piso ${fm[1]}`, title: clean || 'Espacio', person, desc: item.caption || '', kind: 'Espacio' };
}

/**
 * Álbum «Recorrido y momentos»: en reposo muestra solo una portada estática y un botón «Iniciar recorrido»
 * (nada se anima ni se descarga de más, y la página sigue navegable). Al iniciarlo abre un visor a pantalla
 * completa (o, si el navegador no lo permite, una capa que cubre la ventana) compuesto como una visita guiada:
 * la foto como protagonista y un panel lateral (franja compacta en móvil) con el piso, el nombre del lugar,
 * la persona, el contador «Espacio NN de NN» y la navegación. Avanza solo con un desvanecido breve y se puede
 * recorrer con las flechas, el teclado o gestos; se cierra con «Cerrar» o Escape. En la última aparece
 * «Finalizar recorrido». Respeta el bloqueo de la inducción (dataset.locked / «albumlock»); onViewed se avisa
 * solo al finalizar. Con movimiento reducido no avanza solo (se usa la navegación).
 */
export async function mountCompanyLife(host: HTMLElement, manifestPath = '/vida-fontana/mural.json', onViewed?: () => void): Promise<void> {
  let items: LifeItem[];
  try {
    const response = await fetch(manifestPath, { cache: 'no-cache' });
    if (!response.ok) throw new Error('No se pudo cargar el álbum.');
    items = parseLifeItems(await response.json());
  } catch {
    host.innerHTML = '<div class="life-unavailable"><p>No pudimos cargar el álbum.</p><button type="button" data-life-retry>Reintentar</button></div>';
    host.querySelector('[data-life-retry]')?.addEventListener('click', () => { void mountCompanyLife(host, manifestPath, onViewed); });
    return;
  }
  if (!items.length) { host.innerHTML = ''; return; }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const total = items.length;
  let completed = false;

  // ----- Portada en reposo -----
  host.innerHTML = `
    <div class="life">
      <div class="life-cover" data-life-cover>
        <img class="life-cover-art" src="${COVER}" alt="" decoding="async">
        <div class="life-cover-card">
          <span class="life-eyebrow" data-life-eyebrow>Recorrido por la empresa</span>
          <h3 data-life-cover-title>Conoce nuestros espacios</h3>
          <p data-life-cover-text>Un paseo por las oficinas y los momentos del día a día de Fontana.</p>
          <button type="button" class="life-start" data-life-start><span class="life-start-icon" aria-hidden="true">${playIcon}</span><span data-life-start-label>Iniciar recorrido</span></button>
          <p class="life-locknote" data-life-locknote hidden>Marca «He leído acerca de la empresa» en Principios de trabajo para iniciar el recorrido.</p>
        </div>
      </div>
    </div>`;

  const startBtn = host.querySelector<HTMLButtonElement>('[data-life-start]')!;
  const startLabel = host.querySelector<HTMLElement>('[data-life-start-label]')!;
  const eyebrowEl = host.querySelector<HTMLElement>('[data-life-eyebrow]')!;
  const coverTitle = host.querySelector<HTMLElement>('[data-life-cover-title]')!;
  const coverText = host.querySelector<HTMLElement>('[data-life-cover-text]')!;
  const lockNote = host.querySelector<HTMLElement>('[data-life-locknote]')!;

  const isLocked = () => host.dataset.locked === 'true';
  function applyLock(): void {
    const locked = isLocked();
    startBtn.disabled = locked;
    lockNote.hidden = !locked;
    host.querySelector('.life-cover')?.classList.toggle('is-locked', locked);
  }
  function updateCover(): void {
    if (completed) {
      eyebrowEl.innerHTML = `<span class="life-done-icon" aria-hidden="true">${checkIcon}</span>Recorrido finalizado`;
      coverTitle.textContent = 'Recorrido finalizado';
      coverText.textContent = 'Ya conociste los espacios y momentos de Fontana. Puedes verlo de nuevo cuando quieras.';
      startLabel.textContent = 'Volver a ver';
    }
  }
  host.addEventListener('albumlock', applyLock);

  // ----- Visor a pantalla completa -----
  let open = false;
  let viewer: HTMLElement | null = null;
  let index = 0, layer = 0, token = 0, timer = 0;
  let weWentFullscreen = false;

  const stopAuto = () => { window.clearTimeout(timer); timer = 0; };
  const startAuto = () => { stopAuto(); if (!reduce.matches && index < total - 1 && !document.hidden) timer = window.setTimeout(() => { show(index + 1); startAuto(); }, INTERVAL); };
  // Navegación manual (flechas/teclado/gestos): avanza y reinicia el avance automático. Si la flecha usada
  // queda deshabilitada en el extremo, el navegador la desenfoca y el foco caería al <body>; se recupera
  // dentro del visor (al botón «Finalizar» si ya está visible, si no al de cerrar).
  const navTo = (i: number) => {
    const hadFocus = !!viewer && viewer.contains(document.activeElement);
    stopAuto(); show(i); startAuto();
    if (hadFocus && viewer) {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !viewer.contains(active) || (active as HTMLButtonElement).disabled) {
        const finishBtn = viewer.querySelector<HTMLButtonElement>('[data-life-finish]');
        (finishBtn && !finishBtn.hidden ? finishBtn : viewer.querySelector<HTMLButtonElement>('[data-life-close]'))?.focus();
      }
    }
  };

  function preload(i: number): void {
    const src = items[i]?.src;
    if (i >= 0 && i < total && src) { const im = new Image(); im.decoding = 'async'; im.src = src; }
  }

  function show(i: number, animate = true): void {
    if (!viewer) return;
    i = Math.max(0, Math.min(total - 1, i));
    index = i;
    const it = items[i]!;
    const d = describe(it);
    const set = (sel: string, text: string) => { viewer!.querySelector<HTMLElement>(sel)!.textContent = text; };
    set('[data-vfloor]', d.eyebrow);
    set('[data-vtitle]', d.title);
    const personEl = viewer.querySelector<HTMLElement>('[data-vperson]')!;
    personEl.textContent = d.person; personEl.hidden = !d.person;
    const descEl = viewer.querySelector<HTMLElement>('[data-vdesc]')!;
    descEl.textContent = d.desc; descEl.hidden = !d.desc;
    set('[data-vcount]', `${d.kind} ${String(i + 1).padStart(2, '0')} de ${total}`);
    viewer.querySelector<HTMLButtonElement>('[data-life-finish]')!.hidden = i !== total - 1;
    const prevBtn = viewer.querySelector<HTMLButtonElement>('[data-life-vprev]');
    const nextBtn = viewer.querySelector<HTMLButtonElement>('[data-life-vnext]');
    if (prevBtn) prevBtn.disabled = i === 0;
    if (nextBtn) nextBtn.disabled = i === total - 1;
    const loadingEl = viewer.querySelector<HTMLElement>('[data-vloading]')!;
    const slides = [...viewer.querySelectorAll<HTMLImageElement>('.life-vslide')];
    if (!it.src) return;
    const mine = ++token;
    loadingEl.classList.add('is-on');
    const loader = new Image();
    loader.decoding = 'async'; loader.src = it.src;
    loader.decode().then(() => {
      if (mine !== token || !viewer) return;
      const next = slides[1 - layer]!, cur = slides[layer]!;
      next.src = it.src!; next.alt = it.alt;
      next.style.transition = animate && !reduce.matches ? '' : 'none';
      next.classList.add('is-active'); next.removeAttribute('aria-hidden');
      cur.classList.remove('is-active'); cur.setAttribute('aria-hidden', 'true');
      layer = 1 - layer;
      loadingEl.classList.remove('is-on');
    }).catch(() => { if (mine === token && viewer) loadingEl.classList.remove('is-on'); });
    preload(i + 1); preload(i - 1);
  }

  function focusables(): HTMLElement[] {
    if (!viewer) return [];
    return [...viewer.querySelectorAll<HTMLElement>('button:not([hidden]):not(:disabled)')];
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeViewer(false); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); navTo(index + 1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); navTo(index - 1); return; }
    if (event.key === 'Tab') {
      const f = focusables();
      if (!f.length) { event.preventDefault(); return; }
      const first = f[0]!, last = f[f.length - 1]!;
      const active = document.activeElement as HTMLElement;
      if (event.shiftKey && (active === first || !viewer!.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !viewer!.contains(active))) { event.preventDefault(); first.focus(); }
    }
  };
  const onFsChange = (): void => {
    // Si el usuario sale de pantalla completa (Escape/controles del navegador) y nosotros la habíamos activado,
    // cerramos también el visor para no quedar en un estado inconsistente.
    if (open && weWentFullscreen && !document.fullscreenElement) closeViewer(false);
  };
  const onVisibility = (): void => { if (document.hidden) stopAuto(); else startAuto(); };

  function openViewer(): void {
    if (open || isLocked()) return;   // evita aperturas duplicadas y respeta el bloqueo
    open = true;
    index = 0; layer = 0;

    viewer = document.createElement('div');
    viewer.className = 'life-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Recorrido por los espacios de Fontana');
    viewer.innerHTML = `
      <aside class="life-vpanel">
        <span class="life-vmark" aria-hidden="true">Fontana</span>
        <div class="life-vmeta" aria-live="polite">
          <span class="life-vfloor" data-vfloor></span>
          <h2 class="life-vtitle" data-vtitle></h2>
          <p class="life-vperson" data-vperson hidden></p>
          <p class="life-vdesc" data-vdesc hidden></p>
        </div>
        <div class="life-vfoot">
          <span class="life-vrule" aria-hidden="true"></span>
          <span class="life-vcount" data-vcount aria-live="polite"></span>
          <div class="life-vnav">
            <button type="button" class="life-vbtn" data-life-vprev aria-label="Espacio anterior">${prevIcon}</button>
            <button type="button" class="life-vbtn" data-life-vnext aria-label="Espacio siguiente">${nextIcon}</button>
          </div>
          <button type="button" class="life-vfinish" data-life-finish hidden>Finalizar recorrido</button>
        </div>
      </aside>
      <div class="life-vstage">
        <span class="life-vfigure">
          <img class="life-vslide is-active" data-layer="0" alt="" decoding="async">
          <img class="life-vslide" data-layer="1" alt="" decoding="async" aria-hidden="true">
        </span>
        <span class="life-vloading" data-vloading aria-hidden="true"></span>
      </div>
      <button type="button" class="life-vclose" data-life-close aria-label="Cerrar recorrido">×</button>`;
    document.body.append(viewer);
    document.documentElement.classList.add('fontana-life-full-open');   // bloquea el scroll de fondo

    // Pantalla completa real si se puede; si no, la capa fija ya cubre la ventana (respaldo automático).
    const request = viewer.requestFullscreen ? viewer.requestFullscreen() : Promise.reject(new Error('no fs'));
    Promise.resolve(request).then(() => { weWentFullscreen = true; }).catch(() => { viewer?.classList.add('is-window'); });

    viewer.addEventListener('click', (event) => {
      const el = event.target as HTMLElement;
      if (el.closest('[data-life-close]')) return closeViewer(false);
      if (el.closest('[data-life-finish]')) return closeViewer(true);
      if (el.closest('[data-life-vprev]')) return navTo(index - 1);
      if (el.closest('[data-life-vnext]')) return navTo(index + 1);
    });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('visibilitychange', onVisibility);

    show(0, false);
    startAuto();
    viewer.querySelector<HTMLButtonElement>('[data-life-close]')!.focus({ preventScroll: true });
  }

  function closeViewer(markCompleted: boolean): void {
    if (!open) return;
    open = false;
    stopAuto();
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('visibilitychange', onVisibility);
    if (weWentFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    weWentFullscreen = false;
    viewer?.remove(); viewer = null;
    document.documentElement.classList.remove('fontana-life-full-open');   // restaura el scroll
    if (markCompleted && !completed) { completed = true; updateCover(); onViewed?.(); }
    // Devuelve el foco al botón de inicio (ahora «Volver a ver» si se completó); la posición de la página
    // no cambió porque el visor era una capa sobre ella.
    startBtn.focus({ preventScroll: true });
  }

  startBtn.addEventListener('click', () => openViewer());
  applyLock();
}
