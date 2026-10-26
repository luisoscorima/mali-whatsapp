-- Additive normalization: historical area strings remain compatible during the cutover.
-- The catalog, rather than hardcoded CHECK lists, defines valid business areas.
CREATE FUNCTION sync_business_area_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved INTEGER;
BEGIN
 SELECT business_area_id INTO resolved FROM business_area_aliases WHERE alias = NEW.area;
 IF resolved IS NULL THEN RAISE EXCEPTION 'Unknown business area: %', NEW.area USING ERRCODE = '23503'; END IF;
 IF TG_OP = 'INSERT' AND NEW.business_area_id IS NOT NULL AND NEW.business_area_id <> resolved THEN
   RAISE EXCEPTION 'Area ID and alias disagree' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.business_area_id IS DISTINCT FROM OLD.business_area_id AND NEW.business_area_id <> resolved THEN
   RAISE EXCEPTION 'Area ID and alias disagree' USING ERRCODE = '23514';
 END IF;
 NEW.business_area_id := resolved;
 RETURN NEW;
END $$;

ALTER TABLE "campaigns" ADD COLUMN business_area_id INTEGER;
UPDATE "campaigns" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "campaigns" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_area_check";
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "campaigns_business_area_idx" ON "campaigns"(business_area_id);
CREATE TRIGGER "campaigns_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "campaigns" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "contact_attribute_definitions" ADD COLUMN business_area_id INTEGER;
UPDATE "contact_attribute_definitions" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "contact_attribute_definitions" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "contact_attribute_definitions" DROP CONSTRAINT IF EXISTS "contact_attribute_definitions_area_check";
ALTER TABLE "contact_attribute_definitions" ADD CONSTRAINT "contact_attribute_definitions_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "contact_attribute_definitions_business_area_idx" ON "contact_attribute_definitions"(business_area_id);
CREATE TRIGGER "contact_attribute_definitions_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "contact_attribute_definitions" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "contact_segments" ADD COLUMN business_area_id INTEGER;
UPDATE "contact_segments" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "contact_segments" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "contact_segments" DROP CONSTRAINT IF EXISTS "contact_segments_area_check";
ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "contact_segments_business_area_idx" ON "contact_segments"(business_area_id);
CREATE TRIGGER "contact_segments_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "contact_segments" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "contacts" ADD COLUMN business_area_id INTEGER;
UPDATE "contacts" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "contacts" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_area_check";
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "contacts_business_area_idx" ON "contacts"(business_area_id);
CREATE TRIGGER "contacts_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "contacts" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "lead_status_definitions" ADD COLUMN business_area_id INTEGER;
UPDATE "lead_status_definitions" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "lead_status_definitions" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "lead_status_definitions" DROP CONSTRAINT IF EXISTS "lead_status_definitions_area_check";
ALTER TABLE "lead_status_definitions" ADD CONSTRAINT "lead_status_definitions_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "lead_status_definitions_business_area_idx" ON "lead_status_definitions"(business_area_id);
CREATE TRIGGER "lead_status_definitions_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "lead_status_definitions" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "contact_origins" ADD COLUMN business_area_id INTEGER;
UPDATE "contact_origins" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "contact_origins" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "contact_origins" DROP CONSTRAINT IF EXISTS "contact_origins_area_check";
ALTER TABLE "contact_origins" ADD CONSTRAINT "contact_origins_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "contact_origins_business_area_idx" ON "contact_origins"(business_area_id);
CREATE TRIGGER "contact_origins_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "contact_origins" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "education_lead_cycles" ADD COLUMN business_area_id INTEGER;
UPDATE "education_lead_cycles" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "education_lead_cycles" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "education_lead_cycles" DROP CONSTRAINT IF EXISTS "education_lead_cycles_area_check";
ALTER TABLE "education_lead_cycles" ADD CONSTRAINT "education_lead_cycles_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "education_lead_cycles_business_area_idx" ON "education_lead_cycles"(business_area_id);
CREATE TRIGGER "education_lead_cycles_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "education_lead_cycles" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "education_lead_entries" ADD COLUMN business_area_id INTEGER;
UPDATE "education_lead_entries" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "education_lead_entries" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "education_lead_entries" DROP CONSTRAINT IF EXISTS "education_lead_entries_area_check";
ALTER TABLE "education_lead_entries" ADD CONSTRAINT "education_lead_entries_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "education_lead_entries_business_area_idx" ON "education_lead_entries"(business_area_id);
CREATE TRIGGER "education_lead_entries_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "education_lead_entries" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "meta_lead_forms" ADD COLUMN business_area_id INTEGER;
UPDATE "meta_lead_forms" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "meta_lead_forms" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "meta_lead_forms" DROP CONSTRAINT IF EXISTS "meta_lead_forms_area_check";
ALTER TABLE "meta_lead_forms" ADD CONSTRAINT "meta_lead_forms_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "meta_lead_forms_business_area_idx" ON "meta_lead_forms"(business_area_id);
CREATE TRIGGER "meta_lead_forms_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "meta_lead_forms" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "meta_lead_form_routes" ADD COLUMN business_area_id INTEGER;
UPDATE "meta_lead_form_routes" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "meta_lead_form_routes" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "meta_lead_form_routes" DROP CONSTRAINT IF EXISTS "meta_lead_form_routes_area_check";
ALTER TABLE "meta_lead_form_routes" ADD CONSTRAINT "meta_lead_form_routes_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "meta_lead_form_routes_business_area_idx" ON "meta_lead_form_routes"(business_area_id);
CREATE TRIGGER "meta_lead_form_routes_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "meta_lead_form_routes" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "meta_leadgen_leads" ADD COLUMN business_area_id INTEGER;
UPDATE "meta_leadgen_leads" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "meta_leadgen_leads" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "meta_leadgen_leads" DROP CONSTRAINT IF EXISTS "meta_leadgen_leads_area_check";
ALTER TABLE "meta_leadgen_leads" ADD CONSTRAINT "meta_leadgen_leads_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "meta_leadgen_leads_business_area_idx" ON "meta_leadgen_leads"(business_area_id);
CREATE TRIGGER "meta_leadgen_leads_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "meta_leadgen_leads" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "tiktok_lead_form_routes" ADD COLUMN business_area_id INTEGER;
UPDATE "tiktok_lead_form_routes" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "tiktok_lead_form_routes" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "tiktok_lead_form_routes" DROP CONSTRAINT IF EXISTS "tiktok_lead_form_routes_area_check";
ALTER TABLE "tiktok_lead_form_routes" ADD CONSTRAINT "tiktok_lead_form_routes_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "tiktok_lead_form_routes_business_area_idx" ON "tiktok_lead_form_routes"(business_area_id);
CREATE TRIGGER "tiktok_lead_form_routes_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "tiktok_lead_form_routes" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "tiktok_leads" ADD COLUMN business_area_id INTEGER;
UPDATE "tiktok_leads" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "tiktok_leads" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "tiktok_leads" DROP CONSTRAINT IF EXISTS "tiktok_leads_area_check";
ALTER TABLE "tiktok_leads" ADD CONSTRAINT "tiktok_leads_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "tiktok_leads_business_area_idx" ON "tiktok_leads"(business_area_id);
CREATE TRIGGER "tiktok_leads_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "tiktok_leads" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "conversations" ADD COLUMN business_area_id INTEGER;
UPDATE "conversations" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "conversations" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_area_check";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "conversations_business_area_idx" ON "conversations"(business_area_id);
CREATE TRIGGER "conversations_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "conversations" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "whatsapp_identity_events" ADD COLUMN business_area_id INTEGER;
UPDATE "whatsapp_identity_events" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "whatsapp_identity_events" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "whatsapp_identity_events" DROP CONSTRAINT IF EXISTS "whatsapp_identity_events_area_check";
ALTER TABLE "whatsapp_identity_events" ADD CONSTRAINT "whatsapp_identity_events_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "whatsapp_identity_events_business_area_idx" ON "whatsapp_identity_events"(business_area_id);
CREATE TRIGGER "whatsapp_identity_events_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "whatsapp_identity_events" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "flows" ADD COLUMN business_area_id INTEGER;
UPDATE "flows" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "flows" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "flows" DROP CONSTRAINT IF EXISTS "flows_area_check";
ALTER TABLE "flows" ADD CONSTRAINT "flows_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "flows_business_area_idx" ON "flows"(business_area_id);
CREATE TRIGGER "flows_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "flows" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "meta_ctwa_ad_leads" ADD COLUMN business_area_id INTEGER;
UPDATE "meta_ctwa_ad_leads" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "meta_ctwa_ad_leads" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "meta_ctwa_ad_leads" DROP CONSTRAINT IF EXISTS "meta_ctwa_ad_leads_area_check";
ALTER TABLE "meta_ctwa_ad_leads" ADD CONSTRAINT "meta_ctwa_ad_leads_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "meta_ctwa_ad_leads_business_area_idx" ON "meta_ctwa_ad_leads"(business_area_id);
CREATE TRIGGER "meta_ctwa_ad_leads_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "meta_ctwa_ad_leads" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "meta_ctwa_ads" ADD COLUMN business_area_id INTEGER;
UPDATE "meta_ctwa_ads" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "meta_ctwa_ads" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "meta_ctwa_ads" DROP CONSTRAINT IF EXISTS "meta_ctwa_ads_area_check";
ALTER TABLE "meta_ctwa_ads" ADD CONSTRAINT "meta_ctwa_ads_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "meta_ctwa_ads_business_area_idx" ON "meta_ctwa_ads"(business_area_id);
CREATE TRIGGER "meta_ctwa_ads_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "meta_ctwa_ads" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "segment_definitions" ADD COLUMN business_area_id INTEGER;
UPDATE "segment_definitions" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "segment_definitions" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "segment_definitions" DROP CONSTRAINT IF EXISTS "segment_definitions_area_check";
ALTER TABLE "segment_definitions" ADD CONSTRAINT "segment_definitions_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "segment_definitions_business_area_idx" ON "segment_definitions"(business_area_id);
CREATE TRIGGER "segment_definitions_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "segment_definitions" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "user_areas" ADD COLUMN business_area_id INTEGER;
UPDATE "user_areas" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "user_areas" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "user_areas" DROP CONSTRAINT IF EXISTS "user_areas_area_check";
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "user_areas_business_area_idx" ON "user_areas"(business_area_id);
CREATE TRIGGER "user_areas_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "user_areas" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "users" ADD COLUMN business_area_id INTEGER;
UPDATE "users" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "users" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_area_check";
ALTER TABLE "users" ADD CONSTRAINT "users_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "users_business_area_idx" ON "users"(business_area_id);
CREATE TRIGGER "users_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "users" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();

ALTER TABLE "whatsapp_templates" ADD COLUMN business_area_id INTEGER;
UPDATE "whatsapp_templates" t SET business_area_id = a.business_area_id FROM business_area_aliases a WHERE a.alias = t.area;
ALTER TABLE "whatsapp_templates" ALTER COLUMN business_area_id SET NOT NULL;
ALTER TABLE "whatsapp_templates" DROP CONSTRAINT IF EXISTS "whatsapp_templates_area_check";
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_business_area_id_fkey" FOREIGN KEY (business_area_id) REFERENCES business_areas(id) ON DELETE RESTRICT;
CREATE INDEX "whatsapp_templates_business_area_idx" ON "whatsapp_templates"(business_area_id);
CREATE TRIGGER "whatsapp_templates_area_reference" BEFORE INSERT OR UPDATE OF area, business_area_id ON "whatsapp_templates" FOR EACH ROW EXECUTE FUNCTION sync_business_area_reference();
-- Personal identity is global. Do not infer/merge people across areas from a phone alone.
CREATE TABLE people (
 id SERIAL PRIMARY KEY,
 mali_one_person_id VARCHAR(100) UNIQUE,
 name VARCHAR(150) NOT NULL,
 last_name VARCHAR(150) NOT NULL DEFAULT '',
 phone VARCHAR(20), email VARCHAR(255), dni VARCHAR(32), whatsapp_user_id VARCHAR(132), birth_date DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX people_phone_idx ON people(phone);
CREATE INDEX people_email_idx ON people(email);
CREATE INDEX people_dni_idx ON people(dni);
ALTER TABLE contacts ADD COLUMN person_id INTEGER;
-- Preserve every legacy identity; explicit consolidation/MALI ONE links remove duplicates later.
INSERT INTO people(id, name, last_name, phone, email, dni, whatsapp_user_id, created_at, updated_at)
 SELECT id, name, last_name, phone, email, dni, whatsapp_user_id, created_at, updated_at FROM contacts;
SELECT setval(pg_get_serial_sequence('people','id'), COALESCE((SELECT max(id) FROM people), 1), EXISTS(SELECT 1 FROM people));
UPDATE contacts SET person_id = id;
ALTER TABLE contacts ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE contacts ADD CONSTRAINT contacts_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT;
CREATE INDEX contacts_person_idx ON contacts(person_id);

-- Compatibility projection: old SQL clients continue reading contacts.name/etc.
-- People owns these fields. Business status, opt-ins, advisor, programs stay per contact/area.
CREATE FUNCTION sync_contact_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p people%ROWTYPE; previous_origin TEXT;
BEGIN
 IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
 IF NEW.person_id IS NULL THEN
   INSERT INTO people(name,last_name,phone,email,dni,whatsapp_user_id) VALUES(NEW.name,NEW.last_name,NEW.phone,NEW.email,NEW.dni,NEW.whatsapp_user_id) RETURNING * INTO p;
   NEW.person_id := p.id;
 ELSIF TG_OP = 'INSERT' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
   SELECT * INTO STRICT p FROM people WHERE id = NEW.person_id;
   NEW.name := p.name; NEW.last_name := p.last_name; NEW.phone := p.phone; NEW.email := p.email; NEW.dni := p.dni; NEW.whatsapp_user_id := p.whatsapp_user_id;
 ELSIF ROW(NEW.name,NEW.last_name,NEW.phone,NEW.email,NEW.dni,NEW.whatsapp_user_id) IS DISTINCT FROM ROW(OLD.name,OLD.last_name,OLD.phone,OLD.email,OLD.dni,OLD.whatsapp_user_id) THEN
   previous_origin := current_setting('mali.person_sync_contact', true);
   PERFORM set_config('mali.person_sync_contact', NEW.id::text, true);
   UPDATE people SET name=NEW.name,last_name=NEW.last_name,phone=NEW.phone,email=NEW.email,dni=NEW.dni,whatsapp_user_id=NEW.whatsapp_user_id,updated_at=now() WHERE id=NEW.person_id;
   PERFORM set_config('mali.person_sync_contact', COALESCE(previous_origin,''), true);
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION sync_person_contacts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE contacts SET name=NEW.name,last_name=NEW.last_name,phone=NEW.phone,email=NEW.email,dni=NEW.dni,whatsapp_user_id=NEW.whatsapp_user_id,updated_at=now()
 WHERE person_id=NEW.id AND id::text <> COALESCE(current_setting('mali.person_sync_contact',true),'')
 AND ROW(name,last_name,phone,email,dni,whatsapp_user_id) IS DISTINCT FROM ROW(NEW.name,NEW.last_name,NEW.phone,NEW.email,NEW.dni,NEW.whatsapp_user_id);
 RETURN NEW;
END $$;
CREATE TRIGGER contact_person_projection BEFORE INSERT OR UPDATE OF person_id,name,last_name,phone,email,dni,whatsapp_user_id ON contacts FOR EACH ROW EXECUTE FUNCTION sync_contact_person();
CREATE TRIGGER person_contact_projection AFTER UPDATE OF name,last_name,phone,email,dni,whatsapp_user_id ON people FOR EACH ROW EXECUTE FUNCTION sync_person_contacts();

CREATE TABLE user_area_memberships (
 id SERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 business_area_id INTEGER NOT NULL REFERENCES business_areas(id) ON DELETE RESTRICT,
 role_slug VARCHAR(40) NOT NULL,
 access_mode VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (access_mode IN ('all','restricted')),
 active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,business_area_id),
 CHECK (role_slug IN ('asesor_comercial','analista','gestor','supervisor','coordinador','master'))
);
CREATE TABLE user_program_grants (
 membership_id INTEGER NOT NULL REFERENCES user_area_memberships(id) ON DELETE CASCADE,
 program_id INTEGER NOT NULL REFERENCES business_programs(id) ON DELETE CASCADE,
 PRIMARY KEY(membership_id,program_id)
);
CREATE TABLE user_line_grants (
 membership_id INTEGER NOT NULL REFERENCES user_area_memberships(id) ON DELETE CASCADE,
 line_id INTEGER NOT NULL REFERENCES whatsapp_lines(id) ON DELETE CASCADE,
 PRIMARY KEY(membership_id,line_id)
);
-- Preserve existing broad grants; program-only legacy grants become restricted memberships.
WITH scopes AS (
 SELECT u.id AS user_id, u.area FROM users u
 UNION SELECT user_id, area FROM user_areas
)
INSERT INTO user_area_memberships(user_id,business_area_id,role_slug,access_mode)
 SELECT s.user_id,a.business_area_id,COALESCE(u.role_slug,'asesor_comercial'),
 CASE WHEN bool_or(a.program_key IS NULL) THEN 'all' ELSE 'restricted' END
 FROM scopes s JOIN business_area_aliases a ON a.alias=s.area JOIN users u ON u.id=s.user_id
 GROUP BY s.user_id,a.business_area_id,u.role_slug;
WITH scopes AS (SELECT id AS user_id, area FROM users UNION SELECT user_id,area FROM user_areas)
INSERT INTO user_program_grants(membership_id,program_id)
 SELECT DISTINCT m.id,p.id FROM scopes s JOIN business_area_aliases a ON a.alias=s.area
 JOIN user_area_memberships m ON m.user_id=s.user_id AND m.business_area_id=a.business_area_id
 JOIN business_programs p ON p.business_area_id=a.business_area_id AND p.slug=a.program_key
 WHERE m.access_mode='restricted';

CREATE FUNCTION enforce_same_business_area() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_area INTEGER; target_area INTEGER;
BEGIN
 IF TG_TABLE_NAME='contact_programs' THEN
   SELECT business_area_id INTO owner_area FROM contacts WHERE id=NEW.contact_id;
   SELECT business_area_id INTO target_area FROM business_programs WHERE id=NEW.program_id;
 ELSIF TG_TABLE_NAME='user_program_grants' THEN
   SELECT business_area_id INTO owner_area FROM user_area_memberships WHERE id=NEW.membership_id;
   SELECT business_area_id INTO target_area FROM business_programs WHERE id=NEW.program_id;
 ELSIF TG_TABLE_NAME='user_line_grants' THEN
   SELECT business_area_id INTO owner_area FROM user_area_memberships WHERE id=NEW.membership_id;
   SELECT business_area_id INTO target_area FROM whatsapp_lines WHERE id=NEW.line_id;
 ELSIF TG_TABLE_NAME='whatsapp_lines' THEN
   IF NEW.program_id IS NULL THEN RETURN NEW; END IF;
   owner_area := NEW.business_area_id;
   SELECT business_area_id INTO target_area FROM business_programs WHERE id=NEW.program_id;
 END IF;
 IF owner_area IS NULL OR target_area IS NULL OR owner_area <> target_area THEN
   RAISE EXCEPTION 'Cross-area relationship is not allowed in %',TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contact_program_area BEFORE INSERT OR UPDATE ON contact_programs FOR EACH ROW EXECUTE FUNCTION enforce_same_business_area();
CREATE TRIGGER program_grant_area BEFORE INSERT OR UPDATE ON user_program_grants FOR EACH ROW EXECUTE FUNCTION enforce_same_business_area();
CREATE TRIGGER line_grant_area BEFORE INSERT OR UPDATE ON user_line_grants FOR EACH ROW EXECUTE FUNCTION enforce_same_business_area();
CREATE TRIGGER line_program_area BEFORE INSERT OR UPDATE OF business_area_id,program_id ON whatsapp_lines FOR EACH ROW EXECUTE FUNCTION enforce_same_business_area();

-- A stable catalog identity cannot be reparented behind historical references.
CREATE FUNCTION prevent_business_reparent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.business_area_id <> NEW.business_area_id THEN
   RAISE EXCEPTION 'Create a new identity instead of changing its business area' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER program_stable_area BEFORE UPDATE OF business_area_id ON business_programs FOR EACH ROW EXECUTE FUNCTION prevent_business_reparent();
CREATE TRIGGER line_stable_area BEFORE UPDATE OF business_area_id ON whatsapp_lines FOR EACH ROW EXECUTE FUNCTION prevent_business_reparent();
CREATE TRIGGER membership_stable_area BEFORE UPDATE OF business_area_id ON user_area_memberships FOR EACH ROW EXECUTE FUNCTION prevent_business_reparent();
CREATE TRIGGER alias_stable_area BEFORE UPDATE OF business_area_id ON business_area_aliases FOR EACH ROW EXECUTE FUNCTION prevent_business_reparent();

CREATE INDEX people_whatsapp_user_id_idx ON people(whatsapp_user_id);

CREATE TABLE person_identity_reviews (
 id SERIAL PRIMARY KEY,
 person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
 business_area_id INTEGER REFERENCES business_areas(id) ON DELETE SET NULL,
 reason VARCHAR(80) NOT NULL,
 phone VARCHAR(20),
 whatsapp_user_id VARCHAR(132),
 dni VARCHAR(32),
 email VARCHAR(255),
 detail JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX person_identity_reviews_person_idx ON person_identity_reviews(person_id);

ALTER TABLE contact_attribute_definitions ADD COLUMN program_id INTEGER REFERENCES business_programs(id) ON DELETE SET NULL;
CREATE INDEX contact_attribute_definitions_program_idx ON contact_attribute_definitions(program_id);

ALTER TABLE contact_attributes ADD COLUMN program_id INTEGER REFERENCES business_programs(id) ON DELETE SET NULL;
DROP INDEX IF EXISTS "contact_attributes_contact_id_attr_key_key";
CREATE UNIQUE INDEX contact_attributes_area_key_uq ON contact_attributes (contact_id, attr_key) WHERE program_id IS NULL;
CREATE UNIQUE INDEX contact_attributes_program_key_uq ON contact_attributes (contact_id, program_id, attr_key) WHERE program_id IS NOT NULL;

ALTER TABLE contact_origins ADD COLUMN program_id INTEGER REFERENCES business_programs(id) ON DELETE SET NULL;
CREATE INDEX contact_origins_program_idx ON contact_origins(program_id);

ALTER TABLE education_lead_entries ADD COLUMN program_id INTEGER REFERENCES business_programs(id) ON DELETE SET NULL;
CREATE INDEX education_lead_entries_program_idx ON education_lead_entries(program_id);

ALTER TABLE education_lead_cycles ADD COLUMN program_id INTEGER REFERENCES business_programs(id) ON DELETE SET NULL;
CREATE INDEX education_lead_cycles_program_idx ON education_lead_cycles(program_id);
