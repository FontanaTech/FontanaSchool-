import './styles.css';
import './company-security.css';
import { mountSecuritySlider } from './company-security';
import { api } from './http';
import { showAppLoading } from './loading';
import type { PrinciplesPanel } from './tutor/principles-panel';
import { mountCompanyLife } from './company-life';

const companyLife = document.querySelector<HTMLElement>('#fontana-life-mural');
if (companyLife) {
  companyLife.dataset.locked = 'true'; // se desbloquea al confirmar la lectura de la empresa
  void mountCompanyLife(companyLife, undefined, () => showAlbumContinue());
}

// Obtiene un elemento obligatorio y detecta referencias HTML incorrectas.
function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`No se encontró el elemento: ${selector}`);
  return result;
}

// NAVEGACIÓN ENTRE HISTORIA, REGLAS, SEGURIDAD Y PRINCIPIOS (en ese orden; cada pestaña se abre al terminar la anterior)
// La ruta permanece visible; su alto determina el espacio al desplazar el contenido.
const learningPath = element('.learning-path');
const pathResizeObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--path-height', `${learningPath.getBoundingClientRect().height}px`);
});
pathResizeObserver.observe(learningPath);
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const policiesTab = element<HTMLButtonElement>('#policies-tab');
const securityTab = element<HTMLButtonElement>('#security-tab');
const principlesTab = element<HTMLButtonElement>('#principles-tab');
let storyUnlocked = false;
// PRINCIPIOS DE TRABAJO: el tutor (con voz) se carga solo al abrir la pestaña y se silencia al salir de ella.
let principles: PrinciplesPanel | null = null;
let principlesVisible = false;
async function showPrinciples(): Promise<void> {
  if (!principles) {
    const { mountPrinciples } = await import('./tutor/principles-panel');
    principles ??= mountPrinciples(element('#principles-mount'), { completed: principlesReviewed, onProgress: updatePrinciplesProgress });
    // La confirmación de lectura vive junto al resumen de los principios, no en un bloque aparte.
    element('#principles-mount').querySelector('[data-confirmation-slot]')?.append(readingConfirmation);
  }
  if (principlesVisible) principles.show(); else principles.hide();
  if (principlesReviewed && !inductionCompleted) saveProgress('metodo');
}
function unlockTab(tab: HTMLButtonElement): void {
  tab.disabled = false;
  tab.removeAttribute('title');
}
function selectTab(index: number): void {
  if (!tabs[index] || tabs[index].disabled) return;
  tabs.forEach((tab, position) => {
    const selected = index === position;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
  });
  principlesVisible = tabs[index] === principlesTab;
  if (principlesVisible || principles) void showPrinciples();

}
function openTab(tab: HTMLButtonElement): void {
  unlockTab(tab);
  selectTab(tabs.indexOf(tab));
  focusContent();
}
// Al terminar los pasos de una pestaña se abre la siguiente y aparece el botón para continuar.
function chainTab(panelId: string, topic: string | undefined, next: HTMLButtonElement, label: string, withAudio = false): void {
  const panel = element(panelId);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'primary security-continue'; button.hidden = true; button.textContent = label;
  button.addEventListener('click', () => openTab(next));
  panel.append(button);
  mountSecuritySlider(panel, topic, () => { unlockTab(next); button.hidden = false; }, withAudio);
}
chainTab('#policies', 'reglas y políticas de la compañía', securityTab, 'Continuar con la seguridad de la información →');
chainTab('#security', undefined, principlesTab, 'Continuar con los principios de trabajo →', true);
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));
  tab.addEventListener('keydown', (event: KeyboardEvent) => {
    const availableTabs = tabs.filter((item) => !item.disabled);
    const position = availableTabs.indexOf(tab);
    if (position < 0) return;
    const destinations: Record<string, number> = {
      ArrowRight: (position + 1) % availableTabs.length,
      ArrowLeft: (position + availableTabs.length - 1) % availableTabs.length,
      Home: 0,
      End: availableTabs.length - 1,
    };
    const destination = destinations[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    const destinationTab = availableTabs[destination];
    selectTab(tabs.indexOf(destinationTab));
    destinationTab.focus();
  });
});
// El avance se guarda la primera vez que se termina cada parte; si falla, se reintenta al volver a terminarla.
const savedProgress = { historia: false, metodo: false };
function saveProgress(paso: 'historia' | 'metodo'): void {
  if (savedProgress[paso]) return;
  savedProgress[paso] = true;
  api('/auth/induccion/avance', { method: 'POST', body: JSON.stringify({ paso }) }).catch(() => {
    savedProgress[paso] = false;
  });
}
function focusContent(): void {
  const content = element('#learning');
  content.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  content.focus({ preventScroll: true });
}

// HISTORIA: abre una cortina y pulsa Siguiente para habilitar la próxima.
const storyCards = [...document.querySelectorAll<HTMLElement>('[data-story]')];
const openedStories = new Set<number>();
const completionDialog = element<HTMLDialogElement>('#story-complete-dialog');
const finishStory = element<HTMLButtonElement>('#finish-story');
let storyCompleted = false;
let highestUnlockedStory = 0;
function openStory(index: number): void {
  const card = storyCards[index];
  const curtain = card.querySelector<HTMLButtonElement>('.story-curtain')!;
  openedStories.add(index);
  card.querySelector<HTMLElement>('.story-content')!.hidden = false;
  curtain.disabled = false;
  curtain.setAttribute('aria-expanded', 'true');
  curtain.setAttribute('aria-hidden', 'true');
  curtain.inert = true;
  card.classList.add('is-open');
}
storyCards.forEach((card, index) => {
  const curtain = card.querySelector<HTMLButtonElement>('.story-curtain')!;
  const content = card.querySelector<HTMLElement>('.story-content')!;
  const advance = card.querySelector<HTMLButtonElement>('.story-next:not(#finish-story)');
  curtain.addEventListener('click', () => {
    if (index > highestUnlockedStory || openedStories.has(index)) return;
    openStory(index);
    content.querySelector<HTMLElement>('h4')!.focus({ preventScroll: true });
  });
  advance?.addEventListener('click', () => {
    if (!openedStories.has(index) || index !== highestUnlockedStory) return;
    const nextCard = storyCards[index + 1];
    if (!nextCard) return;
    highestUnlockedStory = index + 1;
    const nextCurtain = nextCard.querySelector<HTMLButtonElement>('.story-curtain')!;
    nextCurtain.disabled = false;
    nextCurtain.querySelector<HTMLElement>('.curtain-status')!.textContent = 'Haz clic para descubrir';
    advance.hidden = true;
    nextCurtain.focus({ preventScroll: true });
    nextCard.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  });
});

// Finalizar permite abrir el aviso de nuevo si el usuario lo cierra.
finishStory.addEventListener('click', () => {
  if (openedStories.size !== storyCards.length) return;
  // Al repasar, la siguiente pestaña ya está desbloqueada y se abre directamente.
  if (storyUnlocked) { explorePolicies(); return; }
  storyCompleted = true;
  saveProgress('historia');
  finishStory.textContent = 'Continuar con las reglas y políticas →';
  completionDialog.showModal();
});
element('#close-completion').addEventListener('click', () => completionDialog.close());
completionDialog.addEventListener('close', () => {
  if (!storyUnlocked) finishStory.focus({ preventScroll: true });
});

// El botón del aviso abre la pestaña siguiente (Reglas y políticas).
function explorePolicies(): void {
  if (!storyCompleted) return;
  storyUnlocked = true;
  if (completionDialog.open) completionDialog.close();
  openTab(policiesTab);
}
element('#completion-go-principles').addEventListener('click', explorePolicies);

// CONFIRMACIÓN DE LECTURA Y ACCESO A LA RUTA (el paso final está debajo del álbum)
const readingConfirmation = element<HTMLLabelElement>('#reading-confirmation');
const companyRead = element<HTMLInputElement>('#company-read');
const principlesProgress = element('#principles-progress');
let principlesReviewed = false;
// Con la inducción ya terminada (repaso) los principios no vuelven a bloquear el acceso.
let inductionCompleted = false;
// La confirmación de lectura se muestra únicamente al revisar los cinco principios.
function updateReadingAccess(): void {
  readingConfirmation.hidden = !principlesReviewed;
}
function updatePrinciplesProgress({ reviewed, total }: { reviewed: number; total: number }): void {
  if (inductionCompleted) return;
  if (principlesReviewed && reviewed >= total) { updateReadingAccess(); return; }
  principlesReviewed = reviewed >= total;
  if (principlesReviewed) saveProgress('metodo');
  principlesProgress.textContent = principlesReviewed
    ? 'Revisaste los cinco principios. Confirma tu lectura y sigue con el álbum, al final de la página.'
    : `Revisa los cinco principios para continuar. Llevas ${reviewed} de ${total}.`;
  updateReadingAccess();
}
// Sin la confirmación de lectura el álbum permanece bloqueado.
function syncAlbumLock(): void {
  if (!companyLife) return;
  companyLife.dataset.locked = String(!companyRead.checked);
  companyLife.dispatchEvent(new Event('albumlock'));
}
companyRead.addEventListener('change', () => {
  if (!companyRead.checked) albumContinueNote.hidden = true;
  syncAlbumLock();
});

// Después de ver el álbum aparece, debajo, el paso hacia la ruta de formación.
const albumContinue = element('#album-continue');
const albumContinueButton = element<HTMLButtonElement>('#album-continue-button');
const albumContinueNote = element('#album-continue-note');
let finishing = false;
// Termina la inducción inicial y abre la ruta de formación; la experiencia se pregunta en el módulo 02.
async function finishInduction(): Promise<void> {
  if (finishing) return;
  if (!principlesReviewed || !companyRead.checked) {
    albumContinueNote.textContent = 'Antes de continuar, termina la historia, las reglas, la seguridad y los principios de trabajo, y confirma tu lectura.';
    albumContinueNote.hidden = false;
    return;
  }
  finishing = true;
  const originalLabel = albumContinueButton.textContent;
  albumContinueButton.disabled = true;
  albumContinueButton.textContent = 'Preparando tu ruta…';
  companyRead.disabled = true;
  albumContinueNote.hidden = true;
  try {
    const result = await fetch('/api/auth/induccion/completar', { method: 'POST', credentials: 'same-origin' });
    if (result.status === 401) { location.assign('/login'); return; }
    if (result.status === 404) throw new Error('El servidor necesita actualizarse. Reinicia el servidor de Fontana e intenta nuevamente.');
    if (!result.ok) {
      const body: unknown = await result.json().catch(() => null);
      const message = body && typeof body === 'object' && 'message' in body ? body.message : undefined;
      throw new Error(typeof message === 'string' ? message : 'No pudimos continuar. Intenta nuevamente.');
    }
    showAppLoading('Preparando tu ruta de formación…');
    location.assign('/practica');
  } catch (error) {
    albumContinueNote.textContent = error instanceof TypeError
      ? 'No pudimos conectar con el servidor. Revisa tu conexión e intenta nuevamente.'
      : error instanceof Error ? error.message : 'No pudimos continuar. Intenta nuevamente.';
    albumContinueNote.hidden = false;
    companyRead.disabled = false;
    albumContinueButton.disabled = false;
    albumContinueButton.textContent = originalLabel;
    finishing = false;
  }
}
albumContinueButton.addEventListener('click', () => { void finishInduction(); });
function showAlbumContinue(): void {
  albumContinue.hidden = false;
  albumContinue.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
}
// Al volver, lo que el asesor ya completó queda desbloqueado: los bloqueos solo aplican la primera vez.
export function restoreProgress(progress: { historia: boolean; metodo: boolean; completada: boolean }): void {
  const historia = progress.historia || progress.metodo || progress.completada;
  if (historia) {
    savedProgress.historia = true;
    storyCards.forEach((_, index) => openStory(index));
    highestUnlockedStory = storyCards.length - 1;
    document.querySelectorAll<HTMLButtonElement>('.story-next:not(#finish-story)').forEach((button) => { button.hidden = true; });
    storyCompleted = true;
    storyUnlocked = true;
    finishStory.textContent = 'Continuar con las reglas y políticas →';
    // Quien ya terminó la historia no repite el orden: todo queda abierto para repasar.
    [policiesTab, securityTab, principlesTab].forEach(unlockTab);
    document.querySelectorAll<HTMLButtonElement>('.security-continue').forEach((button) => { button.hidden = false; });
  }
  if (progress.metodo || progress.completada) {
    savedProgress.metodo = true;
    principlesReviewed = true;
    principlesProgress.textContent = 'Ya completaste los principios de trabajo.';
    // Solo la inducción terminada restaura también la confirmación final.
    inductionCompleted = progress.completada;
    companyRead.checked = progress.completada;
    syncAlbumLock();
    updateReadingAccess();
  }
}

// CARRUSEL: cambia CAROUSEL_INTERVAL para ajustar el tiempo, en milisegundos.
const CAROUSEL_INTERVAL = 2000;
const carousel = element('.carousel');
// La foto de Nuestra historia conserva las mismas medidas del carrusel.
const carouselResizeObserver = new ResizeObserver(() => {
  const { width, height } = carousel.getBoundingClientRect();
  document.documentElement.style.setProperty('--carousel-width', `${width}px`);
  document.documentElement.style.setProperty('--carousel-height', `${height}px`);
});
carouselResizeObserver.observe(carousel);
const slides = [...carousel.querySelectorAll<HTMLImageElement>('.slide')];
const dots = [...carousel.querySelectorAll<HTMLButtonElement>('[data-slide]')];
let activeSlide = 0;
let carouselTimer: number | undefined;
function showSlide(index: number): void {
  activeSlide = index;
  slides.forEach((slide, position) => {
    const selected = index === position;
    slide.classList.toggle('is-active', selected);
    slide.setAttribute('aria-hidden', String(!selected));
    dots[position].classList.toggle('is-active', selected);
    dots[position].setAttribute('aria-pressed', String(selected));
  });
}
function startCarousel(): void {
  window.clearInterval(carouselTimer);
  // Con movimiento reducido las fotos no cambian solas; se navegan con los puntos.
  if (document.hidden || carousel.contains(document.activeElement) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  carouselTimer = window.setInterval(() => showSlide((activeSlide + 1) % slides.length), CAROUSEL_INTERVAL);
}
dots.forEach((dot, index) => dot.addEventListener('click', () => { showSlide(index); startCarousel(); }));
carousel.addEventListener('focusin', () => window.clearInterval(carouselTimer));
carousel.addEventListener('focusout', () => window.setTimeout(startCarousel, 0));
document.addEventListener('visibilitychange', startCarousel);
startCarousel();

// Evita temporizadores duplicados cuando Vite actualiza el código al guardar.
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.clearInterval(carouselTimer);
  principles?.destroy();
  pathResizeObserver.disconnect();
  carouselResizeObserver.disconnect();
});
