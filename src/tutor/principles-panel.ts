import { createSpeaker, type SpeakerState } from './speaker';
import { PRINCIPLES } from './principles';
import { createTutor } from './tutor';
import { escapar as escape } from '../http';

// Pestaña «Principios de trabajo»: cinco opciones. Al elegir una, el tutor la explica con voz y mueve la boca con ella.
// El texto completo de lo que dice el tutor siempre está visible (HTML normal); el personaje acompaña, no reemplaza.
export type PrinciplesOptions = {
  // La lectura completada pertenece al perfil; al repasar no se exige repetir los audios.
  completed?: boolean;
  // Un principio se completa únicamente cuando termina su audio.
  onProgress?: (state: { reviewed: number; total: number }) => void;
};
export type PrinciplesPanel = {
  show(): void;   // la pestaña se muestra
  hide(): void;   // la pestaña se oculta: la voz se detiene
  destroy(): void;
};

const STATUS: Record<SpeakerState, string> = {
  idle: 'La explicación se reproduce automáticamente. Si no comienza, pulsa «Escuchar».',
  loading: 'Preparando la explicación…',
  playing: 'El tutor te está explicando este principio.',
  paused: 'En pausa. Pulsa «Continuar» para seguir escuchando.',
  error: 'No pudimos reproducir el audio. Puedes leer la explicación en el texto.',
};

export function mountPrinciples(host: HTMLElement, options: PrinciplesOptions = {}): PrinciplesPanel {
  host.innerHTML = `
    <div class="steps principle-options" role="group" aria-label="Los cinco principios de trabajo">${PRINCIPLES.map((principle, index) => `
      <button type="button" class="step${index === 0 ? ' is-active' : ''}" data-principle="${principle.id}" aria-pressed="${index === 0}"><span>${String(principle.order).padStart(2, '0')}</span>${escape(principle.title)}</button>`).join('')}
    </div>
    <article class="step-detail principle-detail">
      <div class="principle-stage">
        <div class="principle-tutor" id="principle-tutor"></div>
        <div class="principle-copy">
          <span class="detail-count" id="principle-count"></span>
          <h4 id="principle-title" tabindex="-1"></h4>
          <p class="principle-summary" id="principle-summary"></p>
        </div>
      </div>
      <div class="detail-note principle-narration"><strong>Esto es lo que explica el tutor</strong><p id="principle-narration"></p></div>
      <button type="button" class="principle-pause" id="principle-play" aria-label="Pausar la explicación">Pausar explicación</button>
      <p class="principle-status" id="principle-status" role="status" aria-live="polite"></p><div class="principle-confirmation" data-confirmation-slot></div>
    </article>`;
  const q = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!;
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-principle]')];
  const playButton = q<HTMLButtonElement>('#principle-play');
  const tutorHost = q<HTMLElement>('#principle-tutor');
  const tutor = createTutor(tutorHost);
  let index = 0;
  let visible = false;
  let finished = false;
  let reviewMode = Boolean(options.completed);
  let highestUnlocked = reviewMode ? PRINCIPLES.length - 1 : 0;
  const reviewed = new Set<string>(reviewMode ? PRINCIPLES.map(principle => principle.id) : []);

  const speaker = createSpeaker(tutor, {
    state(state) {
      const playing = state === 'playing' || state === 'loading';
      tutorHost.classList.toggle('is-talking', state === 'playing');
      playButton.textContent = playing ? 'Pausar explicación' : state === 'paused' ? 'Continuar explicación' : 'Escuchar explicación';
      playButton.hidden = finished && !reviewMode;
      playButton.setAttribute('aria-label', playing ? 'Pausar la explicación' : state === 'paused' ? 'Continuar la explicación' : 'Escuchar la explicación');
      q('#principle-status').textContent = reviewMode && state === 'idle'
        ? 'Ya completaste los cinco principios. Elige cualquiera para repasar sin repetir el recorrido.'
        : STATUS[state];
      if (state === 'error') tutor.react('support');
    },
    progress() {},
    ended() {
      if (!visible || finished) return;
      if (reviewMode) {
        finished = true;
        q('#principle-status').textContent = 'Repaso finalizado. Puedes elegir cualquier principio; tu avance se conserva.';
        return;
      }
      const principle = PRINCIPLES[index]!;
      if (!reviewed.has(principle.id)) {
        reviewed.add(principle.id);
        options.onProgress?.({ reviewed: reviewed.size, total: PRINCIPLES.length });
      }
      highestUnlocked = Math.max(highestUnlocked, Math.min(index + 1, PRINCIPLES.length - 1));
      if (index + 1 < PRINCIPLES.length) select(index + 1, true);
      else {
        finished = true;
        reviewMode = true;
        playButton.hidden = true;
        q('#principle-status').textContent = 'Terminaste de escuchar los cinco principios.';
        tutor.react('complete');
      }
    },
  });

  function select(next: number, autoplay: boolean): void {
    if (next < 0 || next > highestUnlocked) return;
    finished = false;
    playButton.hidden = false;
    index = next;
    const principle = PRINCIPLES[index]!;
    buttons.forEach((button, position) => {
      const locked = position > highestUnlocked;
      button.disabled = locked;
      button.setAttribute('aria-disabled', String(locked));
      button.title = locked ? 'Completa el audio del principio anterior para desbloquearlo.' : '';
      button.classList.toggle('is-active', position === index);
      button.setAttribute('aria-pressed', String(position === index));
    });
    q('#principle-count').textContent = `PRINCIPIO ${String(principle.order).padStart(2, '0')} / ${String(PRINCIPLES.length).padStart(2, '0')}`;
    q('#principle-title').textContent = principle.title;
    q('#principle-summary').textContent = principle.summary;
    q('#principle-narration').textContent = principle.narration;
    speaker.select(principle);
    // Elegir una opción es un gesto del usuario: el navegador permite iniciar la voz.
    if (autoplay) void speaker.toggle();
  }
  buttons.forEach((button, position) => button.addEventListener('click', () => {
    select(position, true);
  }));
  playButton.addEventListener('click', () => { void speaker.toggle(); });
  select(0, false);
  if (reviewMode) {
    finished = true;
    q('#principle-status').textContent = 'Ya completaste los cinco principios. Elige cualquiera para repasar sin repetir el recorrido.';
  }
  options.onProgress?.({ reviewed: reviewed.size, total: PRINCIPLES.length });

  return {
    show() { if (visible) return; visible = true; tutor.pauseAmbient(false); if (!reviewMode && !finished) void speaker.toggle(); },
    hide() { if (visible) { visible = false; speaker.stop(); tutor.pauseAmbient(true); } },
    destroy() { visible = false; speaker.destroy(); tutor.destroy(); host.innerHTML = ''; },
  };
}
