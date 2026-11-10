import type { Request, Response } from 'express';
import { Role, UserStatus } from '../domain/enums.js';
import { validBody, validParams, validQuery } from '../middleware/validate.js';
import type { ActionContext } from '../services/audit.service.js';
import * as courseResetService from '../services/course-reset.service.js';
import { crearSesion } from '../services/session.service.js';
import * as testProgressService from '../services/test-progress.service.js';
import * as userService from '../services/user.service.js';
import type { ChangeStatusBody, CreateUserBody, ListUsersQuery, ResetPasswordBody, SetPasswordBody, UpdateUserBody } from '../validators/user.validator.js';

export function actionContext(request: Request): ActionContext {
  return { actorUserId: request.usuario!.id, requestId: request.requestId, ip: request.ip };
}

export async function listUsers(request: Request, response: Response): Promise<void> {
  const page = await userService.listUsersPage(validQuery<ListUsersQuery>(request));
  response.json({ data: page.items, meta: { nextCursor: page.nextCursor, total: page.total } });
}

export async function createUser(request: Request, response: Response): Promise<void> {
  const user = await userService.createUser(validBody<CreateUserBody>(request), actionContext(request));
  response.status(201).json({ data: user });
}

export async function updateUser(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  response.json({ data: await userService.updateUser(id, validBody<UpdateUserBody>(request), actionContext(request)) });
}

export async function changeStatus(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  response.json({ data: await userService.changeStatus(id, validBody<ChangeStatusBody>(request), actionContext(request)) });
}

export async function resetPassword(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  const result = await userService.resetPassword(id, validBody<ResetPasswordBody>(request).reason, actionContext(request));
  response.json({ data: result });
}

export async function setPassword(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  const body = validBody<SetPasswordBody>(request);
  const { user, version } = await userService.setPassword(id, body.password, body.reason, actionContext(request));
  // Quien cambia su propia contraseña conserva la sesión actual: la cookie se vuelve a firmar con la versión nueva.
  if (id === request.usuario!.id) crearSesion(response, id, version);
  response.json({ data: user });
}

// Cuenta de pruebas: marca un módulo como completado o lo vacía.
export async function setTestModuleCompletion(request: Request, response: Response): Promise<void> {
  const { userId, moduleId } = validParams<{ userId: string; moduleId: string }>(request);
  const { completed } = validBody<{ completed: boolean }>(request);
  response.json({ data: await testProgressService.setModuleCompletion(userId, moduleId, completed, actionContext(request)) });
}

export async function setTestWelcomeCompletion(request: Request, response: Response): Promise<void> {
  const { userId } = validParams<{ userId: string }>(request);
  const { completed } = validBody<{ completed: boolean }>(request);
  response.json({ data: await testProgressService.setWelcomeCompletion(userId, completed, actionContext(request)) });
}

export async function resetCourse(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  response.json({ data: await courseResetService.resetCourse(id, validBody<{ reason: string }>(request).reason, actionContext(request)) });
}

// ---- Alias de la ruta anterior /api/admin/asesores ----------------------------------------

const LEGACY_REASON = 'Cambio de estado desde la ruta anterior /api/admin/asesores';

/** @deprecated Usa GET /api/admin/users. */
export async function legacyList(request: Request, response: Response): Promise<void> {
  const query = validQuery<{ buscar?: string; pagina: number }>(request);
  response.json(await userService.listAdvisorsLegacy(query.buscar, query.pagina));
}

/** @deprecated Usa POST /api/admin/users. */
export async function legacyCreate(request: Request, response: Response): Promise<void> {
  const body = validBody<{ nombreCompleto: string; numeroDocumento: string; password: string }>(request);
  const asesor = await userService.createUser({ ...body, rol: Role.ADVISOR }, actionContext(request));
  response.status(201).json({ asesor });
}

/** @deprecated Usa PATCH /api/admin/users/:id y PATCH /api/admin/users/:id/status. */
export async function legacyUpdate(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  const body = validBody<{ nombreCompleto: string; numeroDocumento: string; estado: 'activo' | 'inactivo' }>(request);
  const context = actionContext(request);
  const current = await userService.getUser(id);
  let asesor = await userService.updateUser(id, { nombreCompleto: body.nombreCompleto, numeroDocumento: body.numeroDocumento }, context);
  if (current.estado !== body.estado) asesor = await userService.changeStatus(id, { estado: body.estado, reason: LEGACY_REASON }, context);
  response.json({ asesor });
}

/** @deprecated Usa PATCH /api/admin/users/:id/status. */
export async function legacyDeactivate(request: Request, response: Response): Promise<void> {
  const { id } = validParams<{ id: string }>(request);
  const asesor = await userService.changeStatus(id, { estado: UserStatus.INACTIVE, reason: LEGACY_REASON }, actionContext(request));
  response.json({ asesor });
}
