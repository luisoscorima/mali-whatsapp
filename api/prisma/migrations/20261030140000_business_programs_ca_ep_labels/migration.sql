-- Display labels for education categories (slugs ca/ep unchanged).
UPDATE business_programs
SET label = CASE slug
  WHEN 'ca' THEN 'Cursos de Arte'
  WHEN 'ep' THEN 'Extensión Profesional'
END
WHERE slug IN ('ca', 'ep');
