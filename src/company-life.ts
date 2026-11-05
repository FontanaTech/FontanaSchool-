import './company-life.css';
import { escapar } from './http';
import { buildAlbumPages, parseLifeItems, type AlbumPage, type LifeItem } from './company-life-model';

const svg = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const photoIcon = svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>');
const playIcon = svg('<path d="m9 5 10 7-10 7V5Z"/>');
const prevIcon = svg('<path d="m15 5-7 7 7 7"/>');
const nextIcon = svg('<path d="m9 5 7 7-7 7"/>');
const eyeIcon = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>');
const pauseIcon = svg('<path d="M9 5v14M15 5v14"/>');
const lockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="alb-shackle" d="M8 11V8a4 4 0 0 1 8 0v3"/><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M12 15v2.5"/></svg>';

// Tiempos del recorrido (ms).
const UNLOCK_MS = 700;
const FLIP_MS = 900;
const ZOOM_MS = 1100;
const HOLD_MS = 1700;
const COVER_MS = 1600;
const LOGO = '/imagenes/fontana-logo.webp';
const COVER = '/vida-fontana/portada.webp';
// Curva suave para la cámara: entra y sale sin tirones.
const EASE = 'cubic-bezier(.4, 0, .22, 1)';

function placeholder(kind: LifeItem['kind']): string {
  return `<span class="alb-placeholder" aria-hidden="true"><span class="alb-placeholder-icon">${kind === 'video' ? playIcon : photoIcon}</span></span>`;
}

function itemHtml(item: LifeItem, position: number): string {
  const preview = item.kind === 'photo' ? item.thumb : item.poster; // miniatura ligera en la hoja
  // Solo se sube al original al enfocar si tiene más píxeles que la miniatura; si no, sería descargar
  // un archivo del mismo tamaño sin ganar nitidez (las fotos verticales de ≤720 px ya no mejoran).
  const sharper = item.kind === 'photo' && item.src && item.src !== preview
    && item.width != null && item.thumbWidth != null && item.width > item.thumbWidth;
  // Las hojas viven dentro de una escena 3D; lazy-loading nativo puede interpretarlas como fuera de pantalla.
  // Por eso la miniatura se difiere con data-src y se carga desde showSpread cuando su hoja se acerca
  // (la hoja fija el tamaño del marco, así que no hay salto al pintar). data-full carga el original al enfocarla.
  const image = preview
    ? `<img data-src="${escapar(preview)}"${sharper ? ` data-full="${escapar(item.src!)}"` : ''} alt="${item.kind === 'photo' ? escapar(item.alt) : ''}" decoding="async">`
    : placeholder(item.kind);
  const media = item.src
    ? `<button type="button" class="alb-media" data-album-open="${escapar(item.id)}" aria-label="${item.kind === 'video' ? 'Reproducir video' : 'Ampliar fotografía'}: ${escapar(item.title)}">${image}${item.kind === 'video' ? `<span class="alb-play">${playIcon}</span>` : ''}</button>`
    : `<div class="alb-media is-coming" role="img" aria-label="Espacio para ${item.kind === 'video' ? 'video' : 'fotografía'} pendiente de añadir">${image}</div>`;
  return `<figure class="alb-item is-${item.kind}${position % 2 ? ' is-b' : ''}" style="--tilt:${[-1.4, 1.1, -.8, 1.5][position % 4]}deg">${media}<figcaption><strong>${escapar(item.title)}</strong>${item.caption ? `<span>${escapar(item.caption)}</span>` : ''}</figcaption></figure>`;
}

function pageHtml(page: AlbumPage, total: number): string {
  switch (page.kind) {
    case 'cover':
      return `<div class="alb-cover"><img class="alb-cover-art" src="${COVER}" alt=""><span class="alb-spine"></span></div>`;
    case 'inside':
      return `<div class="alb-paper alb-center"><span class="alb-eyebrow">Nuestro álbum</span><h3>Momentos que<br><em>nos definen</em></h3><p>${total} ${total === 1 ? 'recuerdo' : 'recuerdos'} del día a día en Fontana.</p></div>`;
    case 'content':
      return `<div class="alb-paper">${page.items!.map((item, i) => itemHtml(item, page.number! + i)).join('')}<span class="alb-number">${page.number}</span></div>`;
    case 'closing':
      return `<div class="alb-paper alb-center"><span class="alb-mark" aria-hidden="true">${photoIcon}</span><p>Aquí guardaremos los próximos momentos.</p></div>`;
    case 'end':
      return `<div class="alb-paper alb-center"><img class="alb-logo" src="${LOGO}" alt=""><h3>Y la historia <em>continúa</em></h3><p>Gracias por ser parte de Fontana.</p></div>`;
    default:
      return `<div class="alb-cover is-back"><img class="alb-logo" src="${LOGO}" alt=""><span class="alb-eyebrow">Fontana · Álbum de la empresa</span></div>`;
  }
}

/**
 * Álbum autónomo. Permanece cerrado tras una pantalla bloqueada hasta pulsar "Ver álbum"; entonces ocupa
 * la pantalla, se abre, se acerca a cada fotografía o video, pasa las hojas y vuelve a empezar.
 * onViewed se avisa cuando termina el recorrido (el álbum se cierra solo) o el visitante sale de pantalla completa tras verlo.
 */
export async function mountCompanyLife(host: HTMLElement, manifestPath = '/vida-fontana/mural.json', onViewed?: () => void): Promise<void> {
  let items: LifeItem[];
  try {
    const response = await fetch(manifestPath, { cache: 'no-cache' });
    if (!response.ok) throw new Error('No se pudo cargar el álbum.');
    items = parseLifeItems(await response.json());
  } catch {
    host.innerHTML = '<div class="alb-unavailable"><button type="button" data-life-retry aria-label="El álbum no está disponible. Volver a cargar" title="Volver a cargar">↻</button></div>';
    host.querySelector('[data-life-retry]')?.addEventListener('click', () => { void mountCompanyLife(host, manifestPath, onViewed); });
    return;
  }
  if (!items.length) { host.innerHTML = ''; return; }

  const pages = buildAlbumPages(items);
  const sheetCount = pages.length / 2;
  const itemPage = new Map<string, number>();
  pages.forEach((page, index) => page.items?.forEach(item => itemPage.set(item.id, index)));
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let spread = 0;           // hojas ya volteadas
  let timer = 0;
  let playing = false;      // el recorrido está en marcha
  let paused = false;       // pausa elegida por el visitante
  let viewing = false;      // vista ampliada abierta
  let inView = false;
  let unlocked = false;
  let seen = false;         // ya se vio completo al menos una vez
  let focused: HTMLElement | null = null; // foto sobre la que está la cámara
  let observer: IntersectionObserver | null = null;
  const progressDenom = Math.max(1, sheetCount - 1);

  const book = () => host.querySelector<HTMLElement>('[data-album-book]');
  const stage = () => host.querySelector<HTMLElement>('[data-album-stage]');
  const setProgress = (fraction: number) => { const bar = host.querySelector<HTMLElement>('[data-album-progress]'); if (bar) bar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`; };
  const wait = (ms: number, next: () => void) => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (playing) next(); }, calm.matches ? Math.min(ms, 400) : ms); };

  // Carga diferida: solo se piden las miniaturas de la hoja actual y sus vecinas, nunca todo el álbum de golpe.
  const hydrate = (img: HTMLImageElement) => { if (img.dataset.src && !img.dataset.hydrated) { img.dataset.hydrated = '1'; img.src = img.dataset.src; } };
  const hydrateNear = (center: number) => {
    const sheets = host.querySelectorAll<HTMLElement>('.alb-sheet');
    for (let j = Math.max(0, center - 1); j <= Math.min(sheetCount - 1, center + 1); j++)
      sheets[j]?.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(hydrate);
  };

  // ----- Pantalla bloqueada y pantalla completa -----
  /** El álbum se desbloquea desde fuera (host.dataset.locked) y mientras tanto muestra el motivo. */
  const isLocked = () => host.dataset.locked === 'true';

  function showGate(): void {
    const locked = isLocked();
    host.innerHTML = `<div class="alb-gate${locked ? ' is-locked' : ''}" data-album-gate><span class="alb-gate-book" aria-hidden="true"><img src="${COVER}" alt=""><span class="alb-spine"></span></span><div class="alb-gate-card"><span class="alb-lock" aria-hidden="true">${lockIcon}</span><span class="alb-eyebrow">Álbum de Fontana</span><h3>${locked ? 'Álbum bloqueado' : 'Momentos que dejan huella'}</h3><p>${locked ? 'Marca «He leído acerca de la empresa» en Principios de trabajo para desbloquearlo.' : 'Un recorrido por el día a día de nuestra empresa.'}</p><button type="button" class="alb-view" data-album-unlock${locked ? ' disabled' : ''}>${eyeIcon}<span>${locked ? 'Bloqueado' : seen ? 'Ver de nuevo' : 'Ver álbum'}</span></button></div></div>`;
  }

  /** Al marcar la lectura el candado se abre y el botón se habilita; al desmarcarla vuelve a bloquearse. */
  function refreshGate(): void {
    const gate = host.querySelector<HTMLElement>('[data-album-gate]');
    if (!gate || unlocked || gate.classList.contains('is-busy') || gate.classList.contains('is-locked') === isLocked()) return;
    if (isLocked()) { showGate(); return; }
    gate.classList.add('is-opening');
    window.setTimeout(() => { if (host.querySelector('[data-album-gate]') === gate) showGate(); }, calm.matches ? 0 : 600);
  }
  host.addEventListener('albumlock', refreshGate);

  /** Ocupa toda la pantalla; si el navegador no lo permite, cubre la página con el mismo diseño. */
  function enterFull(): Promise<void> {
    host.classList.add('is-full');
    document.documentElement.classList.add('fontana-life-full-open');
    const request = host.requestFullscreen ? host.requestFullscreen().catch(() => undefined) : Promise.resolve();
    return Promise.race([request, new Promise<void>(resolve => window.setTimeout(resolve, 900))]).then(() => undefined);
  }

  /** Salir de pantalla completa devuelve el álbum a su pantalla bloqueada, con cierre suave. */
  let closing = false;
  function leaveFull(animateOut = true): void {
    if (!host.classList.contains('is-full') || closing) return;
    const watched = unlocked;
    halt();
    const teardown = () => {
      closing = false;
      host.classList.remove('is-full');
      document.documentElement.classList.remove('fontana-life-full-open');
      if (document.fullscreenElement === host) void document.exitFullscreen().catch(() => undefined);
      observer?.disconnect();
      inView = paused = unlocked = false;
      spread = 0;
      if (watched) seen = true;
      showGate();
      // La portada bloqueada vuelve con una entrada suave, en vez de aparecer de golpe.
      if (!calm.matches) host.querySelector('[data-album-gate]')?.classList.add('is-entering');
      host.scrollIntoView({ block: 'center' });
      if (watched) onViewed?.();
    };
    const alb = host.querySelector<HTMLElement>('.alb');
    // El álbum se funde antes de salir; si el navegador ya salió de pantalla completa (Esc), solo entra la portada.
    if (animateOut && alb && !calm.matches && document.fullscreenElement === host) {
      closing = true;
      alb.classList.add('is-closing');
      window.setTimeout(teardown, 400);
    } else teardown();
  }

  function unlock(): void {
    const gate = host.querySelector<HTMLElement>('[data-album-gate]');
    if (unlocked || isLocked() || !gate || gate.classList.contains('is-busy')) return;
    gate.classList.add('is-busy');
    void enterFull().then(() => {
      gate.classList.add('is-unlocking');
      window.setTimeout(() => reveal(gate), calm.matches ? 0 : UNLOCK_MS);
    });
  }

  /** El álbum aparece debajo de la portada bloqueada; esta se desliza hasta coincidir con la portada del libro y se funde, sin salto. */
  function reveal(gate: HTMLElement): void {
    unlocked = true;
    render();
    host.append(gate);
    const gateBook = gate.querySelector<HTMLElement>('.alb-gate-book');
    const bookCover = host.querySelector<HTMLElement>('.alb-face:not(.is-back) .alb-cover');
    if (!calm.matches && gateBook && bookCover) {
      // Se mide dónde queda la portada del libro y la portada bloqueada se transforma para caer justo encima.
      const from = gateBook.getBoundingClientRect(), to = bookCover.getBoundingClientRect();
      gateBook.style.transition = `transform ${UNLOCK_MS + 200}ms ${EASE}`;
      gateBook.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(${to.height / from.height})`;
    }
    window.requestAnimationFrame(() => gate.classList.add('is-leaving'));
    window.setTimeout(() => gate.remove(), calm.matches ? 0 : UNLOCK_MS + 300);
    stage()?.focus({ preventScroll: true });
    // La pista de pausa se muestra al abrir y se desvanece sola.
    const hint = host.querySelector<HTMLElement>('[data-album-hint]');
    if (hint && !calm.matches) { window.requestAnimationFrame(() => hint.classList.add('is-on')); window.setTimeout(() => hint.remove(), 4200); }
    else hint?.remove();
  }

  // ----- Libro -----
  function render(): void {
    halt();
    observer?.disconnect();
    host.innerHTML = `<div class="alb" role="region" aria-roledescription="álbum" aria-label="Álbum de fotografías y videos de Fontana"><div class="alb-stage" data-album-stage tabindex="0" aria-label="Álbum de Fontana. Pulsa para pausar o reanudar el recorrido"><div class="alb-book" data-album-book><div class="alb-sheets">${Array.from({ length: sheetCount }, (_, j) => `<div class="alb-sheet"><div class="alb-face">${pageHtml(pages[2 * j], items.length)}</div><div class="alb-face is-back">${pageHtml(pages[2 * j + 1], items.length)}</div></div>`).join('')}</div></div><span class="alb-progress" aria-hidden="true"><i data-album-progress></i></span><div class="alb-paused" aria-hidden="true">${pauseIcon}<span>En pausa · pulsa para continuar</span></div><p class="alb-hint" data-album-hint aria-hidden="true">Pulsa en cualquier momento para pausar</p></div><button type="button" class="alb-exit" data-album-exit aria-label="Salir de pantalla completa">×</button></div>`;
    showSpread(spread, false);
    observer = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      if (inView) resume(); else halt();
    }, { threshold: .45 });
    observer.observe(stage()!);
  }

  function showSpread(next: number, animate = true): void {
    const sheets = host.querySelectorAll<HTMLElement>('.alb-sheet');
    const from = spread;
    spread = Math.max(0, Math.min(sheetCount, next));
    hydrateNear(spread); // trae la hoja visible y la siguiente antes de girarlas
    sheets.forEach((sheet, j) => {
      const turned = j < spread;
      const moving = animate && j >= Math.min(from, spread) && j < Math.max(from, spread);
      sheet.classList.toggle('is-turned', turned);
      // La hoja que se voltea queda por encima de las demás y recibe la sombra de giro mientras dura.
      sheet.classList.toggle('is-flipping', moving);
      sheet.style.zIndex = String(moving ? 100 : turned ? j + 1 : sheetCount - j);
      const [front, back] = sheet.querySelectorAll<HTMLElement>('.alb-face');
      front.inert = j !== spread;
      back.inert = j !== spread - 1;
    });
    if (animate) window.setTimeout(() => sheets.forEach((sheet, j) => { sheet.style.zIndex = String(j < spread ? j + 1 : sheetCount - j); sheet.classList.remove('is-flipping'); }), FLIP_MS);
    book()!.dataset.state = spread === 0 ? 'front' : spread === sheetCount ? 'back' : 'open';
    setProgress(spread / progressDenom);
  }

  // ----- Cámara: entra en cada fotografía -----
  function focusOn(item: HTMLElement): void {
    const target = book(), frame = stage();
    if (!target || !frame || calm.matches) return;
    const t = target.getBoundingClientRect(), i = item.getBoundingClientRect(), s = frame.getBoundingClientRect();
    const zoom = t.width / target.offsetWidth;
    const dx = (i.left + i.width / 2 - (t.left + t.width / 2)) / zoom, dy = (i.top + i.height / 2 - (t.top + t.height / 2)) / zoom;
    const scale = Math.max(1.04, Math.min(2.15, (frame.clientWidth * .76) / (i.width / zoom), (frame.clientHeight * .7) / (i.height / zoom)));
    const x = s.left + s.width / 2 - (s.left + target.offsetLeft + target.offsetWidth / 2) - scale * dx;
    const y = s.top + s.height / 2 - (s.top + target.offsetTop + target.offsetHeight / 2) - scale * dy;
    frame.classList.add('is-immersive');
    focused?.classList.remove('is-focus'); focused = item; item.classList.add('is-focus');
    // Al acercar la cámara se sube a la imagen original (nítida en el zoom); se decodifica antes de
    // intercambiarla para que no haya parpadeo. Solo ocurre una vez por foto.
    const img = item.querySelector<HTMLImageElement>('img[data-full]');
    if (img?.dataset.full && !img.dataset.upgraded) {
      img.dataset.upgraded = '1';
      const full = img.dataset.full, loader = new Image();
      loader.decoding = 'async'; loader.src = full;
      loader.decode().then(() => { if (img.isConnected) img.src = full; }).catch(() => undefined);
    }
    target.style.willChange = 'transform';
    target.style.transition = `transform ${ZOOM_MS}ms ${EASE}`;
    target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  function leaveFocus(immediate = false): void {
    const target = book();
    stage()?.classList.remove('is-immersive');
    focused?.classList.remove('is-focus'); focused = null;
    if (!target) return;
    target.style.transition = immediate ? 'none' : `transform ${ZOOM_MS}ms ${EASE}`;
    target.style.transform = '';
    if (immediate) { void target.offsetWidth; target.style.transition = ''; target.style.willChange = ''; }
  }

  // ----- Recorrido automático -----
  /** Visita la hoja actual foto por foto y pasa a la siguiente; al terminar vuelve a la portada. */
  function runSpread(): void {
    const pieces = [...host.querySelectorAll<HTMLElement>('.alb-face:not([inert]) .alb-item')];
    const visit = (index: number): void => {
      if (index < pieces.length) { setProgress((spread + (pieces.length ? index / pieces.length : 0)) / progressDenom); focusOn(pieces[index]); wait(ZOOM_MS + HOLD_MS, () => visit(index + 1)); return; }
      leaveFocus();
      // La página empieza a girar cuando la cámara casi terminó de alejarse, para que el movimiento fluya sin pausa.
      wait(Math.round(ZOOM_MS * 0.8), () => {
        if (spread >= sheetCount - 1) { showSpread(0); wait(FLIP_MS + 700, leaveFull); return; }
        showSpread(spread + 1);
        wait(FLIP_MS + 200, runSpread);
      });
    };
    wait(pieces.length ? 300 : 1200, () => visit(0));
  }

  function openAlbum(): void {
    showSpread(1);
    wait(FLIP_MS + 200, runSpread);
  }

  function halt(): void {
    playing = false;
    window.clearTimeout(timer);
    leaveFocus(true);
  }

  function resume(): void {
    if (!inView || paused || viewing || document.hidden || playing) return;
    playing = true;
    if (spread === 0) wait(COVER_MS / 2, openAlbum); else runSpread();
  }

  const togglePause = () => {
    paused = !paused;
    host.querySelector('.alb')?.classList.toggle('is-paused', paused);
    host.querySelector('[data-album-hint]')?.remove();
    if (paused) halt(); else resume();
  };

  host.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-album-unlock]')) return unlock();
    if (target.closest('[data-album-exit]')) return leaveFull();
    const open = target.closest<HTMLButtonElement>('[data-album-open]');
    const start = items.findIndex(entry => entry.id === open?.dataset.albumOpen);
    if (open && start >= 0) {
      halt();
      viewing = true;
      openMoment(items, start, open, position => showSpread(Math.ceil(itemPage.get(items[position].id)! / 2), false), () => { viewing = false; resume(); });
    } else if (target.closest('[data-album-stage]')) togglePause();
  });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.fullscreenElement) leaveFull();
    else if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).matches('[data-album-stage]')) { event.preventDefault(); togglePause(); }
  });
  host.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const media = img.closest('.alb-media');
    img.remove();
    if (media && !media.querySelector('.alb-placeholder')) media.insertAdjacentHTML('afterbegin', placeholder(media.closest('.is-video') ? 'video' : 'photo'));
  }, true);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) leaveFull(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) halt(); else resume(); });

  showGate();
}

/** Vista ampliada de una fotografía o video, con navegación entre los que tienen archivo. */
function openMoment(list: LifeItem[], start: number, opener: HTMLButtonElement, onChange: (position: number) => void, onClose: () => void): void {
  const playable = list.map((item, position) => ({ item, position })).filter(entry => entry.item.src);
  let current = Math.max(0, playable.findIndex(entry => entry.position === start));
  const dialog = document.createElement('dialog');
  dialog.className = 'fontana-life-viewer';
  const several = playable.length > 1;
  dialog.innerHTML = `<button type="button" class="fontana-life-close" data-life-close aria-label="Cerrar vista ampliada">×</button>${several ? `<button type="button" class="alb-vnav is-prev" data-viewer-prev aria-label="Anterior">${prevIcon}</button><button type="button" class="alb-vnav is-next" data-viewer-next aria-label="Siguiente">${nextIcon}</button>` : ''}<div class="fontana-life-viewer-media"></div><p class="fontana-life-viewer-caption"></p>`;
  const mediaHost = dialog.querySelector<HTMLElement>('.fontana-life-viewer-media')!;
  const captionHost = dialog.querySelector<HTMLElement>('.fontana-life-viewer-caption')!;

  let token = 0;       // la navegación más reciente gana; descarta cargas que llegan tarde
  let closed = false;  // no se toca el DOM tras cerrar
  const fileError = () => {
    // Se retira cualquier imagen o video anterior: nunca se deja una foto que no corresponde al título actual.
    mediaHost.classList.remove('is-loading');
    mediaHost.innerHTML = '<span class="fontana-life-file-error" role="alert" aria-label="Archivo no disponible">!</span>';
  };
  // Precarga solo las imágenes contiguas, para que pasar de una a otra sea inmediato sin bajar todas.
  const preloadNeighbors = () => {
    if (!several) return;
    for (const step of [1, -1]) {
      const neighbor = playable[(current + step + playable.length) % playable.length].item;
      if (neighbor.kind === 'photo' && neighbor.src) { const im = new Image(); im.decoding = 'async'; im.src = neighbor.src; }
    }
  };
  const dimsAttr = (item: LifeItem) => (item.width && item.height ? ` width="${item.width}" height="${item.height}"` : '');

  const show = (autoplay: boolean) => {
    const item = playable[current].item;
    const mine = ++token;
    dialog.setAttribute('aria-label', item.title);
    captionHost.textContent = item.caption ? `${item.title} · ${item.caption}` : item.title;
    if (item.kind === 'video') {
      mediaHost.classList.remove('is-loading');
      mediaHost.innerHTML = `<video controls${autoplay ? ' autoplay' : ''} playsinline preload="metadata"${item.poster ? ` poster="${escapar(item.poster)}"` : ''} aria-label="${escapar(item.title)}"><source src="${escapar(item.src!)}">${item.captions ? `<track kind="captions" src="${escapar(item.captions)}" srclang="es" label="Español" default>` : ''}</video>`;
      const video = mediaHost.querySelector('video')!;
      video.addEventListener('error', fileError, { once: true });
      video.querySelector('source')?.addEventListener('error', fileError, { once: true });
      return;
    }
    // Foto: se decodifica antes de intercambiarla. Al abrir, el visor muestra un indicador discreto;
    // al navegar, la imagen anterior permanece hasta que la nueva está lista, sin huecos ni parpadeos.
    // El tamaño final lo fijan los atributos width/height del <img>, así que no hace falta reservar proporción.
    mediaHost.classList.add('is-loading');
    const loader = new Image();
    loader.decoding = 'async'; loader.src = item.src!;
    loader.decode().then(() => {
      if (mine !== token || closed) return;
      mediaHost.innerHTML = `<img src="${escapar(item.src!)}" alt="${escapar(item.alt)}"${dimsAttr(item)}>`;
      mediaHost.classList.remove('is-loading');
      preloadNeighbors();
    }).catch(() => { if (mine === token && !closed) fileError(); });
  };
  const move = (step: number) => {
    mediaHost.querySelector('video')?.pause();
    current = (current + step + playable.length) % playable.length;
    show(false);
    onChange(playable[current].position);
  };

  dialog.querySelector('[data-life-close]')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-viewer-prev]')?.addEventListener('click', () => move(-1));
  dialog.querySelector('[data-viewer-next]')?.addEventListener('click', () => move(1));
  dialog.addEventListener('keydown', event => {
    if (!several || (event.target as HTMLElement).closest('video')) return;
    if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowLeft') move(-1);
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    closed = true;
    dialog.querySelector('video')?.pause();
    dialog.remove();
    document.documentElement.classList.remove('fontana-life-viewer-open');
    if (opener.isConnected) opener.focus({ preventScroll: true });
    onClose();
  }, { once: true });
  show(true);
  document.body.append(dialog);
  document.documentElement.classList.add('fontana-life-viewer-open');
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-life-close]')!.focus();
}
