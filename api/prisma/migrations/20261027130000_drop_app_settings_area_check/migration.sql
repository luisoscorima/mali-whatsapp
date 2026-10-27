-- Categorías nuevas (p. ej. educacion_norte) usan app_settings.area como ámbito;
-- la validación queda en la aplicación / catálogo de programas.
ALTER TABLE "app_settings" DROP CONSTRAINT IF EXISTS "app_settings_area_check";
