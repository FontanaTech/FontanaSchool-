import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { BCRYPT_ROUNDS } from '../config/security.js';
import { esAdministrador, Role, UserStatus } from '../domain/enums.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import {
  countUsers, findPublicById, listUsers, listUsersByOffset, listUsersSorted, lockActiveAdmins, lockUser, usuarioPublicoSelect,
  type UserListFilters, type UsuarioPublico,
} from '../repositories/usuario.repository.js';
import { decodeCursor, pageOf } from '../utils/cursor.js';
import { rangeToUtc } from '../utils/time.js';
import type { ChangeStatusBody, CreateUserBody, ListUsersQuery, UpdateUserBody } from '../validators/user.validator.js';
import { audit, type ActionContext } from './audit.service.js';
import { initializeForUser } from './progress.service.js';

function duplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String(error.meta?.target ?? '');
    throw new ConflictError(
      target.includes('correo') ? 'Ese correo ya está registrado en otra cuenta.' : 'Ya existe un usuario con ese documento.',
      target.includes('correo') ? 'EMAIL_TAKEN' : 'DOCUMENT_TAKEN',
    );
  }
  throw error;
}

export async function createUser(input: CreateUserBody, context: ActionContext): Promise<UsuarioPublico> {
  const isAdvisor = input.rol === Role.ADVISOR;
  if (!isAdvisor && !input.nombreCompleto) throw new ValidationError('El nombre es obligatorio para un administrador.', { nombreCompleto: 'Escribe el nombre del administrador.' });
  if (!isAdvisor && !input.password) throw new ValidationError('La contraseña es obligatoria para un administrador.', { password: 'Define la contraseña del administrador.' });
  // Los asesores entran solo con su documento: no usan contraseña (se guarda una aleatoria que nadie conoce) y
  // completan su nombre y datos al ingresar; mientras tanto se identifican por el documento.
  const passwordHash = await bcrypt.hash(input.password ?? randomBytes(24).toString('base64url'), BCRYPT_ROUNDS);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.usuario.create({
        data: {
          nombreCompleto: input.nombreCompleto ?? `Asesor ${input.numeroDocumento}`,
          numeroDocumento: input.numeroDocumento,
          tipoDocumento: input.tipoDocumento ?? 'CC',
          correo: input.correo ?? null,
          telefono: input.telefono || null,
          passwordHash,
          rol: input.rol,
          estado: UserStatus.ACTIVE,
          debeCompletarDatos: isAdvisor,
          debeCambiarPassword: false,
          creadoPor: context.actorUserId,
        },
        select: usuarioPublicoSelect,
      });
      if (isAdvisor) {
        await tx.advisorProfile.create({ data: { userId: user.id } });
        await initializeForUser(tx, user.id);
      }
      await audit(tx, context, { action: 'USER_CREATED', entityType: 'Usuario', entityId: user.id, after: user });
      return user;
    });
  } catch (error) { return duplicate(error); }
}

async function assertNotLastAdmin(tx: Prisma.TransactionClient, targetId: string): Promise<void> {
  const admins = await lockActiveAdmins(tx);
  if (admins.length <= 1 && admins.includes(targetId)) {
    throw new ConflictError('No se puede desactivar ni degradar al último administrador activo.', 'LAST_ADMIN');
  }
}

export async function updateUser(id: string, input: UpdateUserBody, context: ActionContext): Promise<UsuarioPublico> {
  if (input.rol !== undefined && id === context.actorUserId) throw new ForbiddenError('No puedes cambiar tu propio rol.', 'SELF_ROLE_CHANGE');
  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, id);
      const before = await findPublicById(tx, id);
      if (!before) throw new NotFoundError('Usuario no encontrado.', 'USER_NOT_FOUND');
      const roleChanges = input.rol !== undefined && input.rol !== before.rol && !(esAdministrador(before.rol) && input.rol === Role.ADMIN);
      if (roleChanges && esAdministrador(before.rol)) await assertNotLastAdmin(tx, id);
      const after = await tx.usuario.update({
        where: { id },
        data: {
          ...(input.nombreCompleto !== undefined ? { nombreCompleto: input.nombreCompleto } : {}),
          ...(input.numeroDocumento !== undefined ? { numeroDocumento: input.numeroDocumento } : {}),
          ...(input.tipoDocumento !== undefined ? { tipoDocumento: input.tipoDocumento } : {}),
          ...(input.correo !== undefined ? { correo: input.correo } : {}),
          ...(input.telefono !== undefined ? { telefono: input.telefono || null } : {}),
          ...(roleChanges ? { rol: input.rol, versionSesion: { increment: 1 } } : {}),
        },
        select: usuarioPublicoSelect,
      });
      if (roleChanges && input.rol === Role.ADVISOR) await initializeForUser(tx, id);
      await audit(tx, context, { action: roleChanges ? 'USER_ROLE_CHANGED' : 'USER_UPDATED', entityType: 'Usuario', entityId: id, before, after, reason: input.reason });
      return after;
    });
  } catch (error) { return duplicate(error); }
}

// Desactivar o bloquear incrementa versionSesion: las sesiones abiertas dejan de servir de inmediato.
export async function changeStatus(id: string, input: ChangeStatusBody, context: ActionContext): Promise<UsuarioPublico> {
  if (id === context.actorUserId) throw new ForbiddenError('No puedes cambiar tu propio estado.', 'SELF_STATUS_CHANGE');
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, id);
    const before = await findPublicById(tx, id);
    if (!before) throw new NotFoundError('Usuario no encontrado.', 'USER_NOT_FOUND');
    if (before.estado === input.estado) throw new ConflictError(`El usuario ya está ${input.estado}.`, 'STATUS_UNCHANGED');
    if (input.estado !== UserStatus.ACTIVE && esAdministrador(before.rol)) await assertNotLastAdmin(tx, id);
    const after = await tx.usuario.update({
      where: { id },
      data: { estado: input.estado, ...(input.estado !== UserStatus.ACTIVE ? { versionSesion: { increment: 1 } } : {}) },
      select: usuarioPublicoSelect,
    });
    await audit(tx, context, { action: 'USER_STATUS_CHANGED', entityType: 'Usuario', entityId: id, before, after, reason: input.reason });
    return after;
  });
}

// Genera una contraseña temporal; se devuelve una sola vez y nunca se audita su valor.
export async function resetPassword(id: string, reason: string | undefined, context: ActionContext): Promise<{ user: UsuarioPublico; temporaryPassword: string }> {
  if (id === context.actorUserId) throw new ForbiddenError('Para cambiar tu propia contraseña usa otra vía.', 'SELF_PASSWORD_RESET');
  const temporaryPassword = randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
  const user = await prisma.$transaction(async (tx) => {
    await lockUser(tx, id);
    const before = await findPublicById(tx, id);
    if (!before) throw new NotFoundError('Usuario no encontrado.', 'USER_NOT_FOUND');
    if (before.rol !== Role.ADVISOR) throw new ValidationError('Solo se puede restablecer la contraseña de un asesor.', { id: 'El usuario no es asesor.' }, 'NOT_ADVISOR');
    const after = await tx.usuario.update({
      where: { id },
      data: { passwordHash, debeCambiarPassword: true, versionSesion: { increment: 1 } },
      select: usuarioPublicoSelect,
    });
    await audit(tx, context, { action: 'USER_PASSWORD_RESET', entityType: 'Usuario', entityId: id, before: { debeCambiarPassword: before.debeCambiarPassword }, after: { debeCambiarPassword: true }, reason });
    return after;
  });
  return { user, temporaryPassword };
}

// El administrador fija la contraseña de un asesor, de otro administrador o la suya. Las sesiones abiertas del
// usuario se cierran (la versión de sesión cambia); quien cambia la propia conserva la sesión actual porque el
// controlador vuelve a firmar su cookie con la versión nueva. El valor nunca se audita.
export async function setPassword(id: string, password: string, reason: string | undefined, context: ActionContext): Promise<{ user: UsuarioPublico; version: number }> {
  const self = id === context.actorUserId;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, id);
    const before = await findPublicById(tx, id);
    if (!before) throw new NotFoundError('Usuario no encontrado.', 'USER_NOT_FOUND');
    // Solo los asesores tienen flujo de cambio obligatorio al ingresar; un administrador recibe la contraseña definitiva.
    const debeCambiarPassword = !self && before.rol === Role.ADVISOR;
    const after = await tx.usuario.update({
      where: { id },
      data: { passwordHash, debeCambiarPassword, versionSesion: { increment: 1 } },
      select: { ...usuarioPublicoSelect, versionSesion: true },
    });
    const { versionSesion, ...user } = after;
    await audit(tx, context, {
      action: self ? 'OWN_PASSWORD_CHANGED' : 'USER_PASSWORD_SET', entityType: 'Usuario', entityId: id,
      before: { debeCambiarPassword: before.debeCambiarPassword }, after: { debeCambiarPassword }, reason,
    });
    return { user: user as UsuarioPublico, version: versionSesion };
  });
}

const encodeOffset = (offset: number) => Buffer.from(String(offset)).toString('base64url');
function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('El cursor de paginación no es válido.', { cursor: 'Cursor inválido.' });
  return offset;
}

function filtersFrom(query: Pick<ListUsersQuery, 'search' | 'role' | 'status' | 'moduleId' | 'progressStatus' | 'lastActivityFrom' | 'lastActivityTo'>): UserListFilters {
  const range = rangeToUtc(query.lastActivityFrom, query.lastActivityTo);
  return {
    search: query.search || undefined,
    role: query.role,
    status: query.status,
    moduleId: query.moduleId,
    progressStatus: query.progressStatus,
    lastActivityFrom: range.from,
    lastActivityTo: range.to,
  };
}

export async function listUsersPage(query: ListUsersQuery) {
  const filters = filtersFrom(query);
  if (query.sortBy) {
    // Con orden por columna, el cursor es el desplazamiento acumulado.
    const skip = decodeOffset(query.cursor);
    const [rows, total] = await Promise.all([listUsersSorted(filters, query.sortBy, query.sortDir, skip, query.limit + 1), countUsers(filters)]);
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: rows.length > query.limit ? encodeOffset(skip + query.limit) : null, total };
  }
  const [rows, total] = await Promise.all([listUsers(filters, decodeCursor(query.cursor), query.limit), countUsers(filters)]);
  const { items, nextCursor } = pageOf(rows, query.limit, (row) => ({ at: row.fechaCreacion, id: row.id }));
  return { items, nextCursor, total };
}

/** @deprecated Solo para la ruta antigua /api/admin/asesores. */
export async function listAdvisorsLegacy(search: string | undefined, page: number) {
  const filters: UserListFilters = { role: Role.ADVISOR, search: search || undefined };
  const [total, asesores] = await Promise.all([countUsers(filters), listUsersByOffset(filters, (page - 1) * 20, 20)]);
  return { asesores, total, pagina: page, paginas: Math.max(1, Math.ceil(total / 20)) };
}

export async function getUser(id: string): Promise<UsuarioPublico> {
  const user = await findPublicById(prisma, id);
  if (!user) throw new NotFoundError('Usuario no encontrado.', 'USER_NOT_FOUND');
  return user;
}
