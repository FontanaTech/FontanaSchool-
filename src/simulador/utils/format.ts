import { escapar } from '../../http';
import { fromDateKey } from './dates';

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatCOP(value: number): string {
  return copFormatter.format(value);
}

/** dd/mm/aaaa. Acepta Date, ISO o `aaaa-mm-dd`. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date =
    value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(value) ? fromDateKey(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatTime(value: Date | string): string {
  return timeFormatter.format(value instanceof Date ? value : new Date(value));
}

export function formatDateTime(value: Date | string): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** mm:ss o h:mm:ss. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}

/** Escapa texto para insertarlo en plantillas HTML. */
export function esc(value: unknown): string {
  return escapar(String(value ?? ''));
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
