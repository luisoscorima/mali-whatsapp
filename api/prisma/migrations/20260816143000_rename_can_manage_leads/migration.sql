-- Rename permission: anuncios → leads (módulo CRM de prospectos)
ALTER TABLE "users" RENAME COLUMN "can_manage_anuncios" TO "can_manage_leads";
