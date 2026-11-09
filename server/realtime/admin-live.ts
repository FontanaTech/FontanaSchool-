import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Request } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { esAdministrador, UserStatus } from '../domain/enums.js';
import { origenPermitido } from '../middleware/auth.js';
import { findSessionUser } from '../repositories/usuario.repository.js';
import { leerSesion } from '../services/session.service.js';

// Canal en vivo para el panel de administración. El servidor no envía datos: solo avisa «algo cambió» y el panel
// vuelve a pedir lo que muestra por la API de siempre (con sus permisos). Así el panel siempre ve lo que hay en la
// base de datos sin depender de recargar la página.
//
// - Ruta: /ws/admin. Solo administradores con sesión vigente (la misma cookie firmada) y desde un origen permitido.
// - Los cambios se detectan en la API: toda petición que modifica datos y termina bien avisa a los administradores.

const PATH = '/ws/admin';
const clients = new Set<WebSocket>();
let timer: NodeJS.Timeout | null = null;

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function authorize(request: IncomingMessage): Promise<{ status: number; text: string } | null> {
  if (!origenPermitido(request.headers.origin, request.headers.host)) return { status: 403, text: 'Forbidden' };
  const session = leerSesion(request as Request);
  if (!session) return { status: 401, text: 'Unauthorized' };
  const user = await findSessionUser(session.userId);
  if (!user || user.estado !== UserStatus.ACTIVE || user.versionSesion !== session.version || !esAdministrador(user.rol)) return { status: 403, text: 'Forbidden' };
  return null;
}

export function attachAdminLive(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.split('?')[0]?.startsWith(PATH)) return;
    authorize(request).then((denied) => {
      if (denied) { reject(socket, denied.status, denied.text); return; }
      wss.handleUpgrade(request, socket, head, (ws) => {
        clients.add(ws);
        (ws as WebSocket & { alive?: boolean }).alive = true;
        ws.on('pong', () => { (ws as WebSocket & { alive?: boolean }).alive = true; });
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        ws.send(JSON.stringify({ type: 'hello' }));
      });
    }).catch(() => reject(socket, 500, 'Internal Server Error'));
  });
  // Latido: detecta conexiones muertas (cierre de tapa, caída de red) y las libera.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      const tagged = ws as WebSocket & { alive?: boolean };
      if (tagged.alive === false) { ws.terminate(); clients.delete(ws); continue; }
      tagged.alive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
}

// Avisa a los administradores conectados. Agrupa ráfagas (un envío puede tocar varias tablas) en un solo mensaje.
export function publishChange(): void {
  if (!clients.size || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const message = JSON.stringify({ type: 'change', at: Date.now() });
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }, 300);
}

export function liveClientCount(): number {
  return clients.size;
}
