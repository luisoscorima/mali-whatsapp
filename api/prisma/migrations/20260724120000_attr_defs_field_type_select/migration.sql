-- Allow field_type = 'select' (dropdown) on contact_attribute_definitions
ALTER TABLE "contact_attribute_definitions"
  DROP CONSTRAINT "contact_attribute_definitions_field_type_check";

ALTER TABLE "contact_attribute_definitions"
  ADD CONSTRAINT "contact_attribute_definitions_field_type_check"
  CHECK ("field_type" IN ('text', 'number', 'date', 'select'));
