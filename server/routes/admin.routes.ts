import { Router } from 'express';
import { z } from 'zod';
import * as training from '../controllers/admin-training.controller.js';
import * as users from '../controllers/admin-users.controller.js';
import { Role } from '../domain/enums.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as officeAdmin from '../controllers/admin-office.controller.js';
import { adminOfficeRouter } from './admin-office.routes.js';
import { adminCertificationRouter } from './admin-certification.routes.js';
import {
  attemptLimitBody, attemptLimitParams, auditQuery, catalogStatusBody, evaluationBody, metricsQuery, moduleMetricsParams, reactivateBody, reactivateParams, reasonBody,
} from '../validators/admin.validator.js';
import { idParams } from '../validators/common.js';
import { validBody, validParams, validQuery } from '../middleware/validate.js';
import { hrExportBody, hrListQuery, type HrExportBody, type HrListQuery } from '../validators/hr.validator.js';
import { exportProfiles, listCompletedProfiles } from '../services/hr.service.js';
import { advisorCollectionsHistory, advisorCollectionsAttempt } from '../services/collections-admin.service.js';
import { getPerformanceReport } from '../services/performance-report.service.js';
import {
  changeStatusBody, createUserBody, legacyCreateBody, legacyListQuery, legacyUpdateBody, listUsersQuery, resetPasswordBody, setPasswordBody, updateUserBody,
} from '../validators/user.validator.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(Role.ADMIN));

// Recursos humanos: asesores con datos completos y su exportación a Excel (queda en auditoría).
adminRouter.get('/hr/profiles', validate({ query: hrListQuery }), async (request, response) => {
  response.json({ data: await listCompletedProfiles(validQuery<HrListQuery>(request)) });
});
adminRouter.post('/hr/export', validate({ body: hrExportBody }), async (request, response) => {
  const { filename, buffer, count } = await exportProfiles(validBody<HrExportBody>(request).ids, users.actionContext(request));
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.setHeader('X-Fontana-Count', String(count));
  response.send(buffer);
});

// Usuarios
adminRouter.get('/users', validate({ query: listUsersQuery }), users.listUsers);
adminRouter.post('/users', validate({ body: createUserBody }), users.createUser);
adminRouter.patch('/users/:id', validate({ params: idParams, body: updateUserBody }), users.updateUser);
adminRouter.patch('/users/:id/status', validate({ params: idParams, body: changeStatusBody }), users.changeStatus);
adminRouter.post('/users/:id/reset-password', validate({ params: idParams, body: resetPasswordBody }), users.resetPassword);
adminRouter.post('/users/:id/reset-course', validate({ params: idParams, body: reasonBody }), users.resetCourse);
adminRouter.put('/users/:id/password', validate({ params: idParams, body: setPasswordBody }), users.setPassword);
adminRouter.get('/advisors/:id/progress', validate({ params: idParams }), training.advisorProgress);
// Solo la cuenta de pruebas (el servicio lo exige): marcar un módulo como completado o vaciarlo.
adminRouter.put(
  '/advisors/:userId/modules/:moduleId/test-completion',
  validate({ params: z.object({ userId: z.uuid(), moduleId: z.uuid() }).strict(), body: z.object({ completed: z.boolean() }).strict() }),
  users.setTestModuleCompletion,
);
adminRouter.put(
  '/advisors/:userId/welcome/test-completion',
  validate({ params: z.object({ userId: z.uuid() }).strict(), body: z.object({ completed: z.boolean() }).strict() }),
  users.setTestWelcomeCompletion,
);
// Informe de desempeño: examen final, Tipifica, módulos y oportunidades de mejora.
adminRouter.get('/advisors/:id/performance-report', validate({ params: idParams }), async (request, response) => {
  response.json({ data: await getPerformanceReport(validParams<{ id: string }>(request).id) });
});
adminRouter.get('/advisors/:id/collections-exams', validate({ params: idParams, query: z.object({ cursor: z.uuid().optional() }).strict() }), async (request, response) => {
  response.json({ data: await advisorCollectionsHistory(validParams<{ id: string }>(request).id, validQuery<{ cursor?: string }>(request).cursor) });
});
adminRouter.get('/advisors/:id/collections-exams/:attemptId', validate({ params: idParams.extend({ attemptId: z.uuid() }) }), async (request, response) => {
  const { id, attemptId } = validParams<{ id: string; attemptId: string }>(request);
  response.json({ data: await advisorCollectionsAttempt(id, attemptId) });
});
adminRouter.get('/advisors/:id/office', validate({ params: idParams }), officeAdmin.advisorOffice);

// Módulo Ofimática: configuración versionada, contenido, medios
adminRouter.use('/training/office', adminOfficeRouter);

// Validación y certificaciones: solicitudes de reactivación, certificaciones, resúmenes y examen general.
adminRouter.use(adminCertificationRouter);

// Catálogo
adminRouter.get('/modules', training.listModules);
adminRouter.patch('/modules/:id/status', validate({ params: idParams, body: catalogStatusBody }), training.setModuleStatus);
adminRouter.patch('/activities/:id/status', validate({ params: idParams, body: catalogStatusBody }), training.setActivityStatus);
adminRouter.post('/activities/:id/evaluations', validate({ params: idParams, body: evaluationBody }), training.createEvaluation);

// Excepciones individuales
adminRouter.post('/advisors/:userId/activities/:activityId/reactivate', validate({ params: reactivateParams, body: reactivateBody }), training.reactivate);
adminRouter.put('/advisors/:userId/activities/:activityId/attempt-limit', validate({ params: attemptLimitParams, body: attemptLimitBody }), training.setAttemptLimit);
adminRouter.post('/overrides/:id/revoke', validate({ params: idParams, body: reasonBody }), training.revokeOverride);

// Certificados: anular y reemitir. La emisión solo ocurre al aprobar la certificación (ver arriba).
adminRouter.post('/certificates/:id/revoke', validate({ params: idParams, body: reasonBody }), training.revokeCertificate);
adminRouter.post('/certificates/:id/reissue', validate({ params: idParams, body: reasonBody }), training.reissueCertificate);

// Métricas y auditoría
adminRouter.get('/metrics/summary', validate({ query: metricsQuery }), training.metricsSummary);
adminRouter.get('/metrics/location', validate({ query: metricsQuery }), training.metricsLocation);
adminRouter.get('/metrics/modules/:moduleId', validate({ params: moduleMetricsParams, query: metricsQuery }), training.moduleMetrics);
adminRouter.get('/audit', validate({ query: auditQuery }), training.audit);

/** @deprecated Alias de la ruta anterior; usan los mismos servicios. Se retiran cuando ningún cliente las llame. */
adminRouter.get('/asesores', validate({ query: legacyListQuery }), users.legacyList);
/** @deprecated */
adminRouter.post('/asesores', validate({ body: legacyCreateBody }), users.legacyCreate);
/** @deprecated */
adminRouter.put('/asesores/:id', validate({ params: idParams, body: legacyUpdateBody }), users.legacyUpdate);
/** @deprecated */
adminRouter.delete('/asesores/:id', validate({ params: idParams }), users.legacyDeactivate);
