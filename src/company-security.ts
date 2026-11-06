import { SECURITY_AUDIO } from './security-audio';
import { createSecurityAvatar, type SecurityAvatar } from './security-avatar';

let activeSecurityAudio: HTMLAudioElement | null = null;

// autoUnlock=true: elegir un paso habilita el siguiente (reglas y políticas, sin audio).
// autoUnlock=false: el siguiente se habilita solo al terminar el audio del actual (seguridad), vía complete().
export function createSecurityReading(total: number, autoUnlock = true) {
  let current = 0;
  let unlocked = autoUnlock ? Math.min(1, total - 1) : 0;
  const visited = Array<boolean>(total).fill(false); visited[0] = true;
  return {
    state: () => ({ current, unlocked, visited: [...visited] }),
    select(index: number) {
      if (!Number.isInteger(index) || index < 0 || index > unlocked || index >= total) return false;
      current = index; visited[index] = true;
      if (autoUnlock) unlocked = Math.max(unlocked, Math.min(index + 1, total - 1));
      return true;
    },
    // Al terminar el audio de un paso se marca visitado y se habilita el siguiente (auto-avance encadenado).
    complete(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= total) return;
      visited[index] = true; unlocked = Math.max(unlocked, Math.min(index + 1, total - 1));
    },
  };
}

// onComplete se avisa una sola vez, al llegar al último paso (los pasos solo se desbloquean en orden).
// withAudio controla la narración: las reglas y políticas no llevan audio.
export function mountSecuritySlider(root: HTMLElement, topic = 'seguridad de la información', onComplete?: () => void, withAudio = false): void {
  const slides = root.querySelector<HTMLElement>('[data-security-slides]')!;
  const cards = [...slides.querySelectorAll<HTMLElement>('article')];
  if (!cards.length) return;
  const reading = createSecurityReading(cards.length, !withAudio);
  slides.classList.add('security-slider');
  slides.setAttribute('role', 'region');
  slides.setAttribute('aria-label', `Lectura paso a paso de ${topic}`);
  const options = document.createElement('div'); options.className = 'steps security-options';
  options.setAttribute('role', 'group'); options.setAttribute('aria-label', `Los seis pasos de ${topic}`);
  const audios: HTMLAudioElement[] = [];
  const avatars: SecurityAvatar[] = [];
  // Audio por paso, para reproducir en orden y encadenar el avance automático (como los principios).
  const stepAudios: (HTMLAudioElement | null)[] = Array(cards.length).fill(null);
  cards.forEach((card, i) => {
    let avatar: SecurityAvatar | null = null;
    let audioElementForAvatar: HTMLAudioElement | null = null;
    let audioPanel: HTMLElement | null = null;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'step';
    button.dataset.securityStep = String(i); button.setAttribute('aria-controls', `security-slide-${i}`);
    const number = document.createElement('span'); number.textContent = String(i + 1).padStart(2, '0');
    button.append(number, document.createTextNode(card.querySelector('h4')!.textContent!)); options.append(button);
    card.id = `security-slide-${i}`; card.setAttribute('role', 'group'); card.setAttribute('aria-label', `${i + 1} de ${cards.length}`);
    card.querySelector('h4')!.tabIndex = -1;
    const count = card.querySelector<HTMLElement>('.security-number')!;
    count.className = 'detail-count'; count.removeAttribute('aria-hidden'); count.textContent = `PASO ${String(i + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
    const paragraph = card.querySelector('p')!;
    const source = card.querySelector<HTMLElement>('.policy-source');
    const note = document.createElement('div'); note.className = 'detail-note security-explanation';
    const label = document.createElement('strong'); label.textContent = 'Lo que debes recordar';
    note.append(label, paragraph);
    if (source) note.append(source);
    const audioInfo = withAudio ? SECURITY_AUDIO[i] : undefined;
    if (audioInfo) {
      // Narración estilo «Principios»: el <audio> va oculto (solo reproduce y sincroniza el avatar) y el único
      // control visible es un enlace para pausar/escuchar, con una línea de estado accesible debajo.
      const narration = document.createElement('div'); narration.className = 'security-narration';
      narration.setAttribute('aria-label', `Narración del paso ${i + 1}`);
      const audio = document.createElement('audio');
      audioElementForAvatar = audio;
      audio.preload = 'metadata'; audio.src = audioInfo.processed ?? audioInfo.original;
      audio.setAttribute('aria-hidden', 'true'); // el control accesible es el botón; el texto ya está visible arriba
      const playButton = document.createElement('button'); playButton.type = 'button'; playButton.className = 'security-pause';
      const status = document.createElement('p'); status.className = 'security-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      narration.append(audio, playButton, status);
      audioPanel = narration;
      const setControl = (label: string, message: string): void => { playButton.textContent = label; playButton.setAttribute('aria-label', `${label} de este paso`); status.textContent = message; };
      setControl('Escuchar explicación', 'La explicación se reproduce automáticamente. Si no comienza, pulsa «Escuchar».');
      audio.addEventListener('waiting', () => { if (!audio.paused) setControl('Pausar explicación', 'Preparando la explicación…'); });
      audio.addEventListener('play', () => {
        if (activeSecurityAudio && activeSecurityAudio !== audio) activeSecurityAudio.pause();
        activeSecurityAudio = audio; setControl('Pausar explicación', 'El tutor te está explicando este paso.');
      });
      audio.addEventListener('pause', () => { if (!audio.ended) setControl('Continuar explicación', 'En pausa. Pulsa «Continuar» para seguir escuchando.'); });
      audio.addEventListener('ended', () => {
        if (activeSecurityAudio === audio) activeSecurityAudio = null;
        setControl('Escuchar explicación', 'Terminó la explicación de este paso.');
        // Al terminar el audio se habilita y se avanza al siguiente paso; en el último se cierra el recorrido.
        reading.complete(i);
        if (i + 1 < cards.length) goTo(i + 1, true);
        else { paint(); if (!completed) { completed = true; onComplete?.(); } }
      });
      audio.addEventListener('error', () => { if (activeSecurityAudio === audio) activeSecurityAudio = null; setControl('Escuchar explicación', 'No pudimos reproducir el audio. Puedes leer la explicación en el texto.'); });
      // Clic en el enlace: alterna reproducir/pausar, igual que el botón de «Principios».
      playButton.addEventListener('click', () => { if (audio.paused || audio.ended) void audio.play().catch(() => {}); else audio.pause(); });
      audios.push(audio); stepAudios[i] = audio;
    }
    const avatarSrc = slides.dataset.securityAvatar;           // imagen estática (Reglas y políticas)
    const avatarFrames = slides.dataset.securityAvatarFrames;  // carpeta de fotogramas (Seguridad, animado)
    if (avatarSrc || avatarFrames) {
      // Mismo reparto que los principios: personaje a la izquierda, número y título a la derecha, explicación debajo.
      const stage = document.createElement('div'); stage.className = 'principle-stage security-stage';
      const figure = document.createElement('figure'); figure.className = 'security-avatar';
      if (audioElementForAvatar && avatarFrames) {
        // El avatar hace la coreografía y mueve la boca con el volumen de la voz; vuelve a reposo en pausa, fin, error o carga.
        avatar = createSecurityAvatar(figure, { dir: avatarFrames });
        avatar.attach(audioElementForAvatar);
        avatars.push(avatar);
      } else {
        const image = new Image(); image.src = avatarSrc ?? `${avatarFrames}/f0.webp`; image.alt = ''; image.decoding = 'async';
        figure.append(image);
      }
      const copy = document.createElement('div'); copy.className = 'principle-copy';
      copy.append(count, card.querySelector('h4')!); stage.append(figure, copy); card.append(stage);
    }
    // Igual que en «Principios»: el bloque explicativo y, debajo como hermanos, los controles de narración.
    card.append(note);
    if (audioPanel) card.append(audioPanel);
  });
  const detail = document.createElement('div'); detail.className = 'step-detail security-detail';
  detail.append(...cards); slides.append(options, detail);
  const stopAudio = (): void => { audios.forEach((audio) => { if (!audio.paused) audio.pause(); }); avatars.forEach((item) => item.stop()); if (activeSecurityAudio && audios.includes(activeSecurityAudio)) activeSecurityAudio = null; };
  // Al mostrar la pestaña (gesto del usuario que la selecciona) se reproduce el paso actual; al ocultarla se detiene.
  const visibilityObserver = new MutationObserver(() => { if (root.hidden) stopAudio(); else if (withAudio && !completed) playStep(reading.state().current); });
  visibilityObserver.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  const onDocumentHidden = (): void => { if (document.hidden) stopAudio(); };
  const lifecycleObserver = new MutationObserver(() => {
    if (!root.isConnected) { stopAudio(); avatars.forEach((item) => item.destroy()); visibilityObserver.disconnect(); lifecycleObserver.disconnect(); document.removeEventListener('visibilitychange', onDocumentHidden); }
  });
  lifecycleObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', onDocumentHidden, { passive: true });
  const steps = [...slides.querySelectorAll<HTMLButtonElement>('[data-security-step]')];
  let completed = false;
  function paint(focus = false) {
    const state = reading.state();
    // Sin audio (reglas y políticas) se completa al llegar al último paso; con audio se completa al terminar su narración.
    if (!completed && !withAudio && state.visited[cards.length - 1]) { completed = true; onComplete?.(); }
    cards.forEach((card, i) => { card.hidden = state.current !== i; });
    steps.forEach((button, i) => {
      button.disabled = i > state.unlocked;
      button.toggleAttribute('aria-current', i === state.current);
      if (i === state.current) button.setAttribute('aria-current', 'step');
      const status = i === state.current ? 'Estás aquí' : state.visited[i] ? 'Puedes repasar' : i > state.unlocked ? 'Bloqueado' : 'Siguiente tema';
      button.classList.toggle('is-active', i === state.current);
      button.setAttribute('aria-pressed', String(i === state.current));
      button.title = i > state.unlocked ? 'Recorre el tema anterior para desbloquearlo.' : state.visited[i] ? 'Puedes repasar.' : 'Selecciona este tema al terminar de leer el anterior.';
      button.setAttribute('aria-label', `Paso ${i + 1}: ${cards[i]!.querySelector('h4')!.textContent}. ${status}`);
    });
    if (focus) {
      cards[state.current]!.querySelector<HTMLElement>('h4')!.focus({ preventScroll: true });
      slides.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  // Reproduce desde el inicio el audio del paso indicado (si existe). El avatar reacciona a los eventos del audio.
  function playStep(index: number): void {
    const audio = stepAudios[index];
    if (!audio) return;
    audio.currentTime = 0;
    if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) audio.load();
    // Si el navegador bloquea la reproducción (sin gesto previo), el usuario puede iniciarla con los controles.
    void audio.play().catch(() => {});
  }
  // Navega a un paso habilitado; detiene el audio anterior y, en modo audio, reproduce el nuevo.
  function goTo(index: number, autoplay: boolean): void {
    if (!reading.select(index)) return;
    stopAudio();
    paint(true);
    if (autoplay && withAudio) playStep(index);
  }
  steps.forEach((button, i) => button.addEventListener('click', () => goTo(i, true)));
  paint();
  if (withAudio && !root.hidden) playStep(reading.state().current);
}
