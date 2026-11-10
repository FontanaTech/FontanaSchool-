import type { OfficeModuleConfig, Prisma } from '@prisma/client';
import { prisma, type Db } from '../config/prisma.js';
import {
  DEFAULT_OFFICE_CONFIG, OFFICE_MODULE_SLUG, OFFICE_SECTIONS, SECTION_ORDER, type OfficeConfigValues, type OfficeSection,
} from '../domain/office.js';

// Consultas del módulo de Ofimática. Las reglas de negocio viven en services/office-*.service.ts.

export type OfficeConfig = OfficeConfigValues & { id: string | null; version: number; status: string; reason: string | null; createdAt: Date | null };

export function configFromRow(row: OfficeModuleConfig): OfficeConfig {
  return {
    id: row.id, version: row.version, status: row.status, reason: row.reason, createdAt: row.createdAt,
    typingDurationSeconds: row.typingDurationSeconds,
    typingMinCorrectCpm: row.typingMinCorrectCpm,
    typingMinAccuracy: Number(row.typingMinAccuracy),
    typingMaxAttempts: row.typingMaxAttempts,
    typingStartWindowSeconds: row.typingStartWindowSeconds,
    typingAttemptTtlMinutes: row.typingAttemptTtlMinutes,
    excelMinScore: Number(row.excelMinScore),
    excelMaxAttempts: row.excelMaxAttempts,
    dictationMinScore: Number(row.dictationMinScore),
    dictationMaxAttempts: row.dictationMaxAttempts,
    dictationMaxPlays: row.dictationMaxPlays,
  };
}

// Versión vigente. Si la base aún no tiene configuración, se usan los valores iniciales (versión 0).
export async function activeConfig(db: Db = prisma): Promise<OfficeConfig> {
  const row = await db.officeModuleConfig.findFirst({ where: { moduleKey: OFFICE_MODULE_SLUG, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
  if (row) return configFromRow(row);
  return { ...DEFAULT_OFFICE_CONFIG, id: null, version: 0, status: 'ACTIVE', reason: null, createdAt: null };
}

export function configHistory(db: Db = prisma, take = 50) {
  return db.officeModuleConfig.findMany({
    where: { moduleKey: OFFICE_MODULE_SLUG }, orderBy: { version: 'desc' }, take,
    include: { createdBy: { select: { id: true, nombreCompleto: true } } },
  });
}

export type OfficeActivities = {
  moduleId: string;
  moduleName: string;
  bySection: Record<OfficeSection, { id: string; status: string; type: string; title: string; isRequired: boolean; route: string | null } | undefined>;
};

// Actividades del módulo por sección (la orden fija la migración). Las archivadas no aparecen.
export async function officeActivities(db: Db = prisma): Promise<OfficeActivities | null> {
  // Módulo y actividades a la vez: una ida a la base en vez de dos en serie (Prisma carga cada relación aparte).
  const [module, activities] = await Promise.all([
    db.trainingModule.findUnique({ where: { slug: OFFICE_MODULE_SLUG }, select: { id: true, name: true } }),
    db.activity.findMany({ where: { module: { slug: OFFICE_MODULE_SLUG }, order: { in: Object.values(SECTION_ORDER) } } }),
  ]);
  if (!module) return null;
  const bySection = {} as OfficeActivities['bySection'];
  for (const section of OFFICE_SECTIONS) {
    const activity = activities.find((item) => item.order === SECTION_ORDER[section]);
    bySection[section] = activity
      ? { id: activity.id, status: activity.status, type: activity.type, title: activity.title, isRequired: activity.isRequired, route: activity.route }
      : undefined;
  }
  return { moduleId: module.id, moduleName: module.name, bySection };
}

// Qué secciones y lecciones vio el asesor.
export function viewsOf(db: Db, userId: string, activityIds: string[]) {
  return db.activitySectionView.findMany({ where: { userId, activityId: { in: activityIds } }, select: { activityId: true, sectionKey: true, viewedAt: true } });
}

export function recordView(db: Db, userId: string, activityId: string, sectionKey: string) {
  return db.activitySectionView.upsert({
    where: { userId_activityId_sectionKey: { userId, activityId, sectionKey } },
    create: { userId, activityId, sectionKey }, update: {},
  });
}

export type OfficeWhere = Prisma.TypingAttemptResultWhereInput;
