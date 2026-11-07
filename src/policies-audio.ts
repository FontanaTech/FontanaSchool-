// Relación única entre cada paso de «Reglas y políticas» y su audio.
export type PolicyAudio = {
  id: string;
  original: string;
};

export const POLICY_AUDIO: readonly PolicyAudio[] = [
  { id: 'politicas-01-horario', original: '/policies/audio/01-cumple-horario.mp3' },
  { id: 'politicas-02-respeto', original: '/policies/audio/02-trata-con-respeto.mp3' },
  { id: 'politicas-03-responsabilidad', original: '/policies/audio/03-responsabilidad-honestidad.mp3' },
  { id: 'politicas-04-informacion', original: '/policies/audio/04-protege-informacion.mp3' },
  { id: 'politicas-05-salud', original: '/policies/audio/05-cuida-salud.mp3' },
  { id: 'politicas-06-derechos', original: '/policies/audio/06-conoce-derechos.mp3' },
];
