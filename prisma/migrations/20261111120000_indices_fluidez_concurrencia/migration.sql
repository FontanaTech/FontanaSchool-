-- Performance indexes for user progress filters.
CREATE INDEX "idx_progreso_modulo_usuario_filtro"
  ON "induccion"."progreso_modulo" ("user_id", "module_id", "status", "last_activity_at");

CREATE INDEX "idx_progreso_actividad_usuario_filtro"
  ON "induccion"."progreso_actividad" ("user_id", "activity_id", "status", "last_activity_at");
