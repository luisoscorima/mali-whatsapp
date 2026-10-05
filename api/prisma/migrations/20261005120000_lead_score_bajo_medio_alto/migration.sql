-- Lead score: estrellas 1–5 → Bajo/Medio/Alto (1–3).
-- Mapeo: 1–2 → 1 (Bajo), 3 → 2 (Medio), 4–5 → 3 (Alto).

ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_lead_score_check";

UPDATE "contacts"
SET "lead_score" = CASE
  WHEN "lead_score" IS NULL THEN NULL
  WHEN "lead_score" <= 2 THEN 1
  WHEN "lead_score" = 3 THEN 2
  ELSE 3
END
WHERE "lead_score" IS NOT NULL;

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_lead_score_check"
  CHECK ("lead_score" IS NULL OR ("lead_score" >= 1 AND "lead_score" <= 3));

ALTER TABLE "education_lead_cycles" DROP CONSTRAINT IF EXISTS "education_lead_cycles_score_check";

UPDATE "education_lead_cycles"
SET "lead_score" = CASE
  WHEN "lead_score" IS NULL THEN NULL
  WHEN "lead_score" <= 2 THEN 1
  WHEN "lead_score" = 3 THEN 2
  ELSE 3
END
WHERE "lead_score" IS NOT NULL;

ALTER TABLE "education_lead_cycles"
  ADD CONSTRAINT "education_lead_cycles_score_check"
  CHECK ("lead_score" IS NULL OR ("lead_score" >= 1 AND "lead_score" <= 3));
