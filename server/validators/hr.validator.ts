import { z } from 'zod';
import { dateParam, uuid } from './common.js';

// Recursos humanos: asesores con los datos personales completos, filtrados por la fecha en que los registraron.
export const hrListQuery = z.object({
  from: dateParam.optional(),
  to: dateParam.optional(),
  q: z.string().trim().max(100).optional(),
});
export type HrListQuery = z.infer<typeof hrListQuery>;

export const hrExportBody = z.object({
  ids: z.array(uuid).min(1, 'Selecciona al menos un asesor.').max(1000, 'Exporta como máximo 1000 asesores a la vez.'),
}).strict();
export type HrExportBody = z.infer<typeof hrExportBody>;
