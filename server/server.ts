import { env } from './config/env.js';
import { disconnect, keepConnectionsWarm } from './config/prisma.js';
import { app } from './app.js';
import { attachAdminLive } from './realtime/admin-live.js';
import { existeAdministrador } from './services/bootstrap-admin.service.js';

// Las conexiones a la base se abren de una vez al arrancar (en paralelo, mientras se ve el inicio de sesión) y se
// mantienen abiertas mientras el asesor trabaja. Ver keepConnectionsWarm.
keepConnectionsWarm();

// Nunca se imprimen contraseñas al arrancar: el administrador inicial se crea con el script CLI.
try {
  if (!await existeAdministrador()) console.warn('No existe administrador; ejecuta npm run admin:bootstrap');
} catch (error) {
  console.error('No se pudo comprobar si existe un administrador:', error instanceof Error ? error.message : error);
}

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Fontana School disponible en http://localhost:${env.PORT}`);
});

attachAdminLive(server);

async function shutdown(signal: string): Promise<void> {
  console.log(`Cerrando servidor (${signal})...`);
  server.close(async () => {
    await disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
