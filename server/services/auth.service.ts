import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { BCRYPT_ROUNDS } from '../config/security.js';
import { esAdministrador, Role, UserStatus } from '../domain/enums.js';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../domain/errors.js';
import type { AuthUser } from '../domain/usuario.js';
import { findForLogin, touchLastAccess, usuarioSesionSelect } from '../repositories/usuario.repository.js';
import type { AvanceInduccionBody, CompletarDatosBody, ExperienciaBody, LoginBody } from '../validators/auth.validator.js';
import { Prisma } from '@prisma/client';

const GENERIC_FAILURE = 'Credenciales incorrectas o cuenta inactiva.';
// Hash de relleno para que un documento inexistente tarde lo mismo que una contraseña errónea.
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('fontana-relleno-sin-uso', BCRYPT_ROUNDS);
  return dummyHash;
}

type LoginContext = { ip?: string; requestId?: string };

function logLogin(event: 'login_success' | 'login_failure', data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test') return;
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
}

// El asesor se identifica solo por documento (sin contraseña); el administrador, por documento o correo y con
// contraseña. Nunca por nombre.
export async function login(input: LoginBody, context: LoginContext): Promise<AuthUser> {
  const usuario = await findForLogin(input.identificador, input.tipo);
  const valid = input.tipo === Role.ADMIN ? await bcrypt.compare(input.password, usuario?.passwordHash ?? await getDummyHash()) : true;
  const roleMatches = usuario ? (input.tipo === Role.ADMIN ? esAdministrador(usuario.rol) : usuario.rol === Role.ADVISOR) : false;
  if (!usuario || !valid || !roleMatches || usuario.estado !== UserStatus.ACTIVE) {
    const reason = !usuario ? 'not_found' : !valid ? 'bad_password' : !roleMatches ? 'role_mismatch' : `status_${usuario.estado}`;
    logLogin('login_failure', { userId: usuario?.id ?? null, tipo: input.tipo, reason, ip: context.ip, requestId: context.requestId });
    throw new UnauthorizedError(GENERIC_FAILURE, 'INVALID_CREDENTIALS');
  }
  await touchLastAccess(usuario.id);
  logLogin('login_success', { userId: usuario.id, tipo: input.tipo, ip: context.ip, requestId: context.requestId });
  const { passwordHash: _hash, ...safe } = usuario;
  void _hash;
  return safe;
}

// "Cerrar todas las sesiones": invalida todas las cookies emitidas para el usuario.
export async function logoutEverywhere(userId: string): Promise<void> {
  await prisma.usuario.update({ where: { id: userId }, data: { versionSesion: { increment: 1 } } });
}

// Respuesta de experiencia dentro del módulo «Inducción a las cobranzas»: define si el asesor hace la
// introducción o va directo al examen. Responderla implica haber terminado la inducción inicial.
export async function registrarExperiencia(usuario: AuthUser, input: ExperienciaBody): Promise<AuthUser> {
  if (usuario.debeCompletarDatos) throw new ForbiddenError('Completa tu perfil de asesor antes de continuar.', 'PROFILE_INCOMPLETE');
  // La respuesta se da una sola vez: cambiarla después del examen diagnóstico alteraría el camino ya recorrido.
  const answered = usuario.tieneExperienciaCobranzasDigitales !== null && usuario.tieneExperienciaCobranzasDigitales !== undefined;
  return prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      ...(answered ? {} : { tieneExperienciaCobranzasDigitales: input.tieneExperienciaCobranzasDigitales, fechaRespuestaExperiencia: new Date() }),
      fechaInduccionCompletada: usuario.fechaInduccionCompletada ?? new Date(),
      // Responder la experiencia implica haber terminado la historia y el método.
      fechaHistoriaCompletada: usuario.fechaHistoriaCompletada ?? new Date(),
      fechaMetodoCompletado: usuario.fechaMetodoCompletado ?? new Date(),
    },
    select: usuarioSesionSelect,
  });
}

// Cierra la inducción inicial («Conoce la empresa») y abre la ruta de formación. Sin pregunta de experiencia.
export async function completarInduccion(usuario: AuthUser): Promise<AuthUser> {
  if (usuario.debeCompletarDatos) throw new ForbiddenError('Completa tu perfil de asesor antes de continuar.', 'PROFILE_INCOMPLETE');
  if (usuario.fechaInduccionCompletada) return usuario;
  const now = new Date();
  return prisma.usuario.update({
    where: { id: usuario.id },
    data: { fechaInduccionCompletada: now, fechaHistoriaCompletada: usuario.fechaHistoriaCompletada ?? now, fechaMetodoCompletado: usuario.fechaMetodoCompletado ?? now },
    select: usuarioSesionSelect,
  });
}

// Marca como terminada la historia o el método la primera vez; después sus bloqueos no se reactivan.
// Terminar el método implica haber terminado la historia.
export async function registrarAvanceInduccion(usuario: AuthUser, input: AvanceInduccionBody): Promise<AuthUser> {
  if (usuario.debeCompletarDatos) throw new ForbiddenError('Completa tu perfil de asesor antes de continuar.', 'PROFILE_INCOMPLETE');
  const now = new Date();
  const data = {
    ...(usuario.fechaHistoriaCompletada ? {} : { fechaHistoriaCompletada: now }),
    ...(input.paso === 'metodo' && !usuario.fechaMetodoCompletado ? { fechaMetodoCompletado: now } : {}),
  };
  if (!Object.keys(data).length) return usuario;
  return prisma.usuario.update({ where: { id: usuario.id }, data, select: usuarioSesionSelect });
}

export async function completarDatos(usuario: AuthUser, input: CompletarDatosBody): Promise<AuthUser> {
  try {
    return await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        nombre: input.nombre,
        apellidos: input.apellidos,
        nombreCompleto: `${input.nombre} ${input.apellidos}`,
        tipoDocumento: input.tipoDocumento,
        numeroDocumento: input.numeroDocumento,
        fechaNacimiento: new Date(`${input.fechaNacimiento}T00:00:00.000Z`),
        sexo: input.sexo,
        tipoSangre: input.tipoSangre,
        tallaCamisa: input.tallaCamisa,
        direccionResidencia: input.direccionResidencia,
        nombreContactoEmergencia: input.nombreContactoEmergencia,
        numeroContactoEmergencia: input.numeroContactoEmergencia,
        banco: input.banco,
        otroBanco: input.banco === 'Otros' ? input.otroBanco : null,
        numeroCuenta: input.numeroCuenta,
        correo: input.correo,
        telefono: input.telefono || null,
        debeCompletarDatos: false,
        debeCambiarPassword: false,
        fechaDatosCompletados: new Date(),
      },
      select: usuarioSesionSelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target ?? '');
      if (target.includes('numero_documento')) throw new ConflictError('Este número de documento ya está registrado en otra cuenta.', 'DOCUMENT_TAKEN');
      throw new ConflictError('Este correo ya está registrado en otra cuenta. Usa un correo diferente.', 'EMAIL_TAKEN');
    }
    throw error;
  }
}
