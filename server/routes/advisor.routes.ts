import { Router } from 'express';
import { z } from 'zod';
import { certificatePdfFile, celebrated, certification, moduleBySlug, modules, progress } from '../controllers/advisor.controller.js';
import { Role } from '../domain/enums.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { advisorOpportunities } from '../services/performance-report.service.js';

export const advisorRouter = Router();
advisorRouter.use(requireAuth, requireRole(Role.ADVISOR));
advisorRouter.get('/modules', modules);
advisorRouter.get('/modules/:slug', validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/, 'Módulo inválido.') }) }), moduleBySlug);
advisorRouter.get('/progress', progress);
advisorRouter.get('/certification', certification);
advisorRouter.post('/certification/celebrated', validate({ body: z.object({}).strict() }), celebrated);
advisorRouter.get('/certificate.pdf', certificatePdfFile);
// Oportunidades de mejora del sistema experto cuando el asesor no logra certificarse.
advisorRouter.get('/opportunities', async (request, response) => {
  response.json({ data: await advisorOpportunities(request.usuario!.id) });
});
