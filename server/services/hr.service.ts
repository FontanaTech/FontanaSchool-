import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { Role } from '../domain/enums.js';
import { NotFoundError } from '../domain/errors.js';
import { rangeToUtc } from '../utils/time.js';
import { audit, type ActionContext } from './audit.service.js';

// Recursos humanos: los asesores que ya completaron sus datos personales («Completar datos» al primer ingreso),
// con filtro por la fecha en que los registraron, y su exportación a Excel.

export type HrQuery = { from?: string; to?: string; q?: string };

const PROFILE_SELECT = {
  id: true, nombre: true, apellidos: true, nombreCompleto: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true,
  sexo: true, tipoSangre: true, tallaCamisa: true, correo: true, telefono: true, direccionResidencia: true, nombreContactoEmergencia: true,
  numeroContactoEmergencia: true, banco: true, otroBanco: true, numeroCuenta: true, estado: true, tieneExperienciaCobranzasDigitales: true,
  fechaDatosCompletados: true, fechaCreacion: true,
} satisfies Prisma.UsuarioSelect;

type ProfileRow = Prisma.UsuarioGetPayload<{ select: typeof PROFILE_SELECT }>;

export type HrProfile = ReturnType<typeof profileOf>;

function profileOf(row: ProfileRow) {
  return {
    id: row.id,
    nombre: row.nombre ?? '',
    apellidos: row.apellidos ?? '',
    nombreCompleto: row.nombreCompleto,
    tipoDocumento: row.tipoDocumento,
    numeroDocumento: row.numeroDocumento,
    // Fecha sin hora: se entrega tal cual (AAAA-MM-DD), sin pasar por zona horaria.
    fechaNacimiento: row.fechaNacimiento ? row.fechaNacimiento.toISOString().slice(0, 10) : null,
    sexo: row.sexo ?? '',
    tipoSangre: row.tipoSangre ?? '',
    tallaCamisa: row.tallaCamisa ?? '',
    correo: row.correo ?? '',
    telefono: row.telefono ?? '',
    direccionResidencia: row.direccionResidencia ?? '',
    nombreContactoEmergencia: row.nombreContactoEmergencia ?? '',
    numeroContactoEmergencia: row.numeroContactoEmergencia ?? '',
    banco: row.banco === 'Otros' && row.otroBanco ? row.otroBanco : row.banco ?? '',
    numeroCuenta: row.numeroCuenta ?? '',
    experiencia: row.tieneExperienciaCobranzasDigitales,
    estado: row.estado,
    fechaDatosCompletados: row.fechaDatosCompletados?.toISOString() ?? null,
    fechaCreacion: row.fechaCreacion.toISOString(),
  };
}

// Solo asesores con los datos completos; el rango de fechas se interpreta en la zona horaria de la aplicación.
function whereCompleted(query: HrQuery): Prisma.UsuarioWhereInput {
  const range = rangeToUtc(query.from, query.to);
  const text = query.q?.trim();
  return {
    rol: Role.ADVISOR,
    debeCompletarDatos: false,
    fechaDatosCompletados: { not: null, ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) },
    ...(text ? { OR: [{ nombreCompleto: { contains: text, mode: 'insensitive' } }, { numeroDocumento: { contains: text } }] } : {}),
  };
}

export async function listCompletedProfiles(query: HrQuery): Promise<HrProfile[]> {
  const rows = await prisma.usuario.findMany({
    where: whereCompleted(query),
    select: PROFILE_SELECT,
    orderBy: [{ fechaDatosCompletados: 'desc' }, { apellidos: 'asc' }, { nombre: 'asc' }],
    take: 1000,
  });
  return rows.map(profileOf);
}

// ---------------------------------------------------------------------------------------------
// Excel

// Hora local de la aplicación como fecha «de pared»: Excel no maneja zonas horarias y exceljs escribe las fechas en UTC.
function wallClock(date: Date, timeZone = env.APP_TIMEZONE): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}

const dateOnly = (value: string | null): Date | null => (value ? new Date(`${value}T00:00:00Z`) : null);
const dateTime = (value: string | null): Date | null => (value ? wallClock(new Date(value)) : null);
const ESTADOS: Record<string, string> = { activo: 'Activo', inactivo: 'Inactivo', bloqueado: 'Bloqueado' };

type Column = { header: string; width: number; value: (profile: HrProfile) => string | Date | null; numFmt?: string };
const COLUMNS: Column[] = [
  { header: 'Nombre', width: 22, value: (p) => p.nombre },
  { header: 'Apellidos', width: 24, value: (p) => p.apellidos },
  { header: 'Tipo de documento', width: 12, value: (p) => p.tipoDocumento },
  { header: 'Número de documento', width: 20, value: (p) => p.numeroDocumento },
  { header: 'Fecha de nacimiento', width: 14, value: (p) => dateOnly(p.fechaNacimiento), numFmt: 'dd/mm/yyyy' },
  { header: 'Sexo', width: 11, value: (p) => p.sexo },
  { header: 'Tipo de sangre', width: 10, value: (p) => p.tipoSangre },
  { header: 'Talla de camisa', width: 10, value: (p) => p.tallaCamisa },
  { header: 'Correo', width: 30, value: (p) => p.correo },
  { header: 'Teléfono', width: 16, value: (p) => p.telefono },
  { header: 'Dirección de residencia', width: 36, value: (p) => p.direccionResidencia },
  { header: 'Contacto de emergencia', width: 26, value: (p) => p.nombreContactoEmergencia },
  { header: 'Teléfono de emergencia', width: 18, value: (p) => p.numeroContactoEmergencia },
  { header: 'Banco', width: 20, value: (p) => p.banco },
  { header: 'Número de cuenta', width: 20, value: (p) => p.numeroCuenta },
  { header: 'Experiencia en cobranzas digitales', width: 16, value: (p) => (p.experiencia === null ? '' : p.experiencia ? 'Sí' : 'No') },
  { header: 'Estado', width: 11, value: (p) => ESTADOS[p.estado] ?? p.estado },
  { header: 'Datos registrados el', width: 18, value: (p) => dateTime(p.fechaDatosCompletados), numFmt: 'dd/mm/yyyy hh:mm' },
  { header: 'Usuario creado el', width: 18, value: (p) => dateTime(p.fechaCreacion), numFmt: 'dd/mm/yyyy hh:mm' },
];

export type HrExport = { filename: string; buffer: Buffer; count: number };

// Libro con una tabla de Excel (filtros en la cabecera, filas alternadas) ordenada por apellidos y nombre.
export async function exportProfiles(ids: string[], context: ActionContext, now = new Date()): Promise<HrExport> {
  const rows = await prisma.usuario.findMany({ where: { id: { in: ids }, rol: Role.ADVISOR, debeCompletarDatos: false, fechaDatosCompletados: { not: null } }, select: PROFILE_SELECT });
  if (!rows.length) throw new NotFoundError('Ninguno de los asesores seleccionados tiene los datos completos.', 'HR_EMPTY_SELECTION');
  const profiles = rows.map(profileOf).sort((a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, 'es'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Fontana School';
  workbook.created = now;
  const sheet = workbook.addWorksheet('Asesores', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addTable({
    name: 'Asesores',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: COLUMNS.map((column) => ({ name: column.header, filterButton: true })),
    rows: profiles.map((profile) => COLUMNS.map((column) => column.value(profile) ?? '')),
  });
  COLUMNS.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = column.width;
    if (column.numFmt) sheetColumn.numFmt = column.numFmt;
  });
  sheet.getRow(1).font = { bold: true };

  const stamp = wallClock(now).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const filename = `Fontana-asesores-datos-${stamp}.xlsx`;
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  // Es una salida de datos personales: queda en auditoría quién exportó y a quiénes.
  await audit(prisma, context, {
    action: 'HR_PROFILES_EXPORTED', entityType: 'ExportacionRRHH', entityId: filename,
    after: { asesores: profiles.length, documentos: profiles.map((profile) => profile.numeroDocumento) },
  });
  return { filename, buffer, count: profiles.length };
}
