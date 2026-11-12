import { env } from './config/env.js';
import { disconnect, keepConnectionsWarm } from './config/prisma.js';
import { app } from './app.js';
import { attachAdminLive } from './realtime/admin-live.js';
import { existeAdministrador } from './services/bootstrap-admin.service.js';
import { captureConsole } from './diagnostics/log-buffer.js';

// Lo que el servidor escribe en la consola también queda en el panel de logs de la aplicación (Ctrl + Shift + L).
captureConsole();

// Guardas a nivel de proceso (tras captureConsole, para que su salida quede también en el panel de logs). No
// ocultan errores: los dejan registrados.
// - Una excepción no capturada deja el proceso en estado dudoso: se cierra de forma ordenada. En la aplicación de
//   escritorio, el supervisor de Electron lo vuelve a levantar; bajo un administrador de procesos, también.
// - Una promesa rechazada sin manejar se registra para corregir su origen, pero no tumba al servidor: así los
//   demás asesores conectados conservan su sesión (Node, por defecto, terminaría el proceso).
process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({ event: 'uncaught_exception', error: error instanceof Error ? error.stack ?? error.message : String(error) }));
  void disconnect().catch(() => undefined).finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ event: 'unhandled_rejection', error: reason instanceof Error ? reason.stack ?? reason.message : String(reason) }));
});

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
