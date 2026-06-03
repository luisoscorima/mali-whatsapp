/**
 * JOIN y agregación de nombre + segmentos para exportaciones de campaña.
 */

function sqlCampaignLogContactJoin(logAlias, areaParam) {
  const la = logAlias;
  return `
    LEFT JOIN contacts ct ON ct.area = ${areaParam} AND (
      ct.id = ${la}.contact_id
      OR (${la}.contact_id IS NULL AND ct.phone = ${la}.phone)
    )`;
}

function sqlContactSegmentLabels(contactIdSql, areaParam) {
  return `COALESCE((
    SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
    FROM contact_segments cs
    JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
    WHERE cs.contact_id = ${contactIdSql} AND cs.area = ${areaParam}
  ), '')`;
}

function sqlCampaignLogContactName(areaParam) {
  return `COALESCE(ct.name, '') AS contact_name`;
}

function sqlCampaignLogSegmentLabels(areaParam) {
  return `${sqlContactSegmentLabels('ct.id', areaParam)} AS segment_labels`;
}

function exportContactName(row) {
  return String(row?.contact_name ?? row?.contactName ?? '');
}

function exportSegmentLabels(row) {
  return String(row?.segment_labels ?? row?.segmentLabels ?? '');
}

module.exports = {
  sqlCampaignLogContactJoin,
  sqlContactSegmentLabels,
  sqlCampaignLogContactName,
  sqlCampaignLogSegmentLabels,
  exportContactName,
  exportSegmentLabels,
};
