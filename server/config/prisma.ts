import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { POOL_DEFAULTS, tunedDatabaseUrl } from './database-url.js';

// Cliente único de Prisma para todo el servidor. Las transacciones interactivas (intentos,
// excepciones) hacen varias consultas seguidas; con la latencia de Neon los 5 s por defecto no bastan.
export const prisma = new PrismaClient({
  datasourceUrl: tunedDatabaseUrl(env.DATABASE_URL),
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
});

// Cliente aceptado por los repositorios: el global o el de una transacción.
export type Db = PrismaClient | Prisma.TransactionClient;

export async function checkConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------------------------
// Conexiones tibias mientras el asesor trabaja.
//
// Prisma cierra una conexión que pasa 5 minutos sin uso, y abrir otra con Neon cuesta ~1,4 s (medido). Leer un
// bloque, practicar en Excel o escribir el dictado lleva más que eso: el siguiente «Continuar» pagaba la reconexión
// (y una pantalla que lanza varias lecturas a la vez, varias reconexiones). Mientras hubo actividad en los últimos
// 30 minutos, cada 4 minutos se usan las conexiones del pool con un SELECT 1 para que sigan abiertas. Sin actividad,
// no se hace nada: las conexiones se cierran solas y Neon puede suspender la base (no consume horas de cómputo).
// Todas las del pool (connection_limit en database-url.ts): así ninguna lectura en paralelo tiene que abrir otra.
const WARM_CONNECTIONS = Number(POOL_DEFAULTS.connection_limit);
const KEEP_WARM_EVERY_MS = 4 * 60_000;
const ACTIVE_WINDOW_MS = 30 * 60_000;
let lastActivityAt = 0;

export function markDatabaseActivity(now = Date.now()): void {
  lastActivityAt = now;
}

export function shouldKeepWarm(now: number, lastActivity = lastActivityAt): boolean {
  return now - lastActivity <= ACTIVE_WINDOW_MS;
}

// Abre (o mantiene) varias conexiones a la vez: consultas simultáneas usan conexiones distintas del pool.
export async function warmConnections(count = WARM_CONNECTIONS): Promise<void> {
  await Promise.all(Array.from({ length: count }, () => prisma.$queryRaw`SELECT 1`));
}

// Al arrancar se abren las conexiones de una vez (mientras se ve el inicio de sesión) y luego se mantienen.
export function keepConnectionsWarm(): () => void {
  markDatabaseActivity();
  void warmConnections().catch(() => undefined);
  const timer = setInterval(() => {
    if (shouldKeepWarm(Date.now())) void warmConnections().catch(() => undefined);
  }, KEEP_WARM_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
