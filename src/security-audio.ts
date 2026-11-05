// Relación única entre cada sección de Seguridad de la información y su audio.
// Los originales se conservan intactos. `processed` queda vacío hasta contar con
// un codificador local completo que permita validar y exportar la limpieza.
export type SecurityAudio = {
  id: string;
  original: string;
  processed: string | null;
  transcript: string | null;
  processingNote: string;
};

export const SECURITY_AUDIO: readonly (SecurityAudio | null)[] = [
  {
    id: 'seguridad-01-cuenta',
    original: '/security/audio/01-usa-tu-propia-cuenta.mp3',
    processed: null,
    transcript: null,
    processingNote: 'Original integrado; limpieza y normalización pendientes de exportación local.',
  },
  {
    id: 'seguridad-02-contrasena',
    original: '/security/audio/02-tu-contrasena-es-personal.mp3',
    processed: null,
    transcript: null,
    processingNote: 'Original integrado; limpieza y normalización pendientes de exportación local.',
  },
  {
    id: 'seguridad-03-equipos-archivos',
    original: '/security/audio/03-cuida-equipos-y-archivos.mp3',
    processed: null,
    transcript: null,
    processingNote: 'Original integrado; limpieza y normalización pendientes de exportación local.',
  },
  {
    id: 'seguridad-04-compartir',
    original: '/security/audio/04-verifica-antes-de-compartir.mp3',
    processed: null,
    transcript: null,
    processingNote: 'Original integrado; limpieza y normalización pendientes de exportación local.',
  },
  {
    id: 'seguridad-05-solicitudes',
    original: '/security/audio/05-canaliza-las-solicitudes.mp3',
    processed: null,
    transcript: null,
    processingNote: 'Original integrado; limpieza y normalización pendientes de exportación local.',
  },
  {
    id: 'seguridad-06-reportes',
    original: '/security/audio/06-reporta-lo-que-ocurra.mp3',
    processed: null,
    transcript: null,
    processingNote: 'Original integrado; limpieza y normalización pendientes de exportación local.',
  },
];
