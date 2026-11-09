import 'dotenv/config';
import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false', '1', '0']).default('false').transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria.'),
  DIRECT_URL: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_SECRET: z.string().optional(),
  APP_TIMEZONE: z.string().default('America/Bogota'),
  TYPING_WEBHOOK_SECRET: z.string().min(16).optional(),
  STALLED_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  CERTIFICATES_ENABLED: booleanFlag,
  // Detrás de un proxy interno: false (por defecto), true/1 (un salto), un número de saltos o una lista de subredes.
  TRUST_PROXY: z.string().default('false').transform((value): boolean | number | string => {
    const text = value.trim().toLowerCase();
    if (text === '' || text === 'false' || text === '0') return false;
    if (text === 'true') return 1;
    return /^d+$/.test(text) ? Number(text) : value.trim();
  }),
  // Carpeta de audios e imágenes: fuera del repositorio y de dist/, en almacenamiento persistente.
  STORAGE_DIR: z.string().optional(),
  MEDIA_SIGNING_SECRET: z.string().min(16).optional(),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  // Recomendaciones opcionales con Ollama local (red privada). Nunca califica.
  OLLAMA_ENABLED: booleanFlag,
  OLLAMA_URL: z.string().url().optional(),
  OLLAMA_MODEL: z.string().default('llama3.2:3b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  // Solo desarrollo y pruebas: reproduce el dictado con la voz del navegador cuando no hay audio autorizado.
  DICTATION_DEV_TTS: booleanFlag,
  // Aplicación de escritorio (Electron): el servidor corre en el mismo equipo y se abre en http://localhost.
  DESKTOP: booleanFlag,
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && (!value.SESSION_SECRET || value.SESSION_SECRET.length < 32)) {
    context.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'SESSION_SECRET debe tener al menos 32 caracteres en producción.' });
  }
  try {
    new Intl.DateTimeFormat('es-CO', { timeZone: value.APP_TIMEZONE });
  } catch {
    context.addIssue({ code: 'custom', path: ['APP_TIMEZONE'], message: 'APP_TIMEZONE no es una zona horaria válida.' });
  }
});

const parsed = schema.safeParse({
  ...process.env,
  TYPING_WEBHOOK_SECRET: process.env.TYPING_WEBHOOK_SECRET || undefined,
  SESSION_SECRET: process.env.SESSION_SECRET || undefined,
  // Una variable vacía en .env equivale a no definirla.
  STORAGE_DIR: process.env.STORAGE_DIR || undefined,
  MEDIA_SIGNING_SECRET: process.env.MEDIA_SIGNING_SECRET || undefined,
  MEDIA_URL_TTL_SECONDS: process.env.MEDIA_URL_TTL_SECONDS || undefined,
  OLLAMA_URL: process.env.OLLAMA_URL || undefined,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || undefined,
  OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS || undefined,
  TRUST_PROXY: process.env.TRUST_PROXY || undefined,
});

if (!parsed.success) {
  const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Configuración inválida. ${detail}`);
}

// La voz de prueba del dictado no existe en producción, aunque la variable esté definida.
export const env = { ...parsed.data, DICTATION_DEV_TTS: parsed.data.DICTATION_DEV_TTS && parsed.data.NODE_ENV !== 'production' };
export const isProduction = env.NODE_ENV === 'production';
