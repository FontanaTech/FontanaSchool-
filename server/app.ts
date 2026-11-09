import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { typingRouter } from './integrations/typing.js';
import { mismaProcedencia } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { requestId } from './middleware/requestId.js';
import { adminRouter } from './routes/admin.routes.js';
import { advisorRouter } from './routes/advisor.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { officeRouter } from './routes/training-office.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { collectionsRouter } from './routes/training-collections.routes.js';
import { objectionsRouter } from './routes/training-objections.routes.js';
import { evaluationRouter } from './routes/training-evaluation.routes.js';
import { certificatesRouter } from './routes/certificates.routes.js';
import { mediaRouter } from './routes/media.routes.js';
import { mountWebView } from './views/web.view.js';
import { publishChange } from './realtime/admin-live.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');

export const app = express();

app.disable('x-powered-by');
// Detrás del proxy interno de la empresa, request.ip debe ser la IP del cliente para el rate limit.
// TRUST_PROXY está desactivada por defecto; se activa con el número de saltos del proxy.
if (env.TRUST_PROXY !== false) app.set('trust proxy', env.TRUST_PROXY);
app.use(requestId);
app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });

// Integraciones antes del parser JSON y fuera de mismaProcedencia: se autentican con firma HMAC.
app.use('/api/integrations/typing', typingRouter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/api', mismaProcedencia);
// Panel de administración en vivo: toda petición que modifica datos y termina bien avisa a los administradores conectados.
app.use('/api', (request, response, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) response.on('finish', () => { if (response.statusCode < 400) publishChange(); });
  next();
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/advisor', advisorRouter);
app.use('/api/training/office', officeRouter);
app.use('/api/training/collections', collectionsRouter);
app.use('/api/training/objections', objectionsRouter);
app.use('/api/training', evaluationRouter);
app.use('/api/certificates', certificatesRouter);
app.use('/api/media', mediaRouter);
app.use('/api/admin', adminRouter);
app.use('/api', apiNotFound);

// En desarrollo (`npm run dev`) la interfaz vive en Vite: si alguien abre este puerto, se le lleva allí para que
// siempre vea el código actual y no la carpeta `dist` compilada hace tiempo.
if (process.argv.includes('--dev')) {
  app.get(/^\/(?!api\/).*/, (request, response) => response.redirect(302, `http://127.0.0.1:5173${request.originalUrl}`));
}
mountWebView(app, path.join(projectRoot, 'dist'));
app.use(errorHandler);
