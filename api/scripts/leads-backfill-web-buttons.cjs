/**
 * Reclasifica organic_wa → web_button cuando el primer inbound es botón WP
 * (`ref:web_*` o «Hola MALI Educación! Vengo desde la web»).
 *
 * Usage (en el contenedor API o con DATABASE_URL):
 *   node api/scripts/leads-backfill-web-buttons.cjs
 *   node api/scripts/leads-backfill-web-buttons.cjs --apply
 *
 * Default: dry-run.
 */
const { PrismaClient, Prisma } = require('@prisma/client');

const apply = process.argv.includes('--apply');

const WEB_REF_RE = /^web(?:[_-][a-z0-9_-]+)?$/i;
const ANCHOR = 'hola mali educacion! vengo desde la web';

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRef(body) {
  const m = String(body ?? '').match(/\bref:([a-zA-Z0-9_-]+)/i);
  return m?.[1] || null;
}

function matchWeb(body) {
  const raw = String(body ?? '').trim();
  if (!raw) return null;
  const ref = extractRef(raw);
  if (ref) {
    if (!WEB_REF_RE.test(ref)) return null;
    return { slug: ref, match: 'ref', label: ref };
  }
  const n = normalize(raw.replace(/\bref:[a-zA-Z0-9_-]+/gi, ''));
  if (!n.includes(ANCHOR)) return null;
  return { slug: 'web_prefill', match: 'text', label: 'Botón web' };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const origins = await prisma.contact_origins.findMany({
      where: {
        channel: 'organic_wa',
        conversation_id: { not: null },
        area: { in: ['educacion', 'educacion_ca', 'educacion_ep'] },
      },
      select: { id: true, area: true, conversation_id: true },
    });

    const byConv = new Map();
    const ids = origins.map((o) => o.conversation_id).filter(Boolean);
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const rows = await prisma.$queryRaw`
        SELECT DISTINCT ON (conversation_id) conversation_id, id, body_text
        FROM chat_messages
        WHERE direction = 'inbound'
          AND conversation_id IN (${Prisma.join(chunk)})
        ORDER BY conversation_id, created_at ASC, id ASC
      `;
      for (const row of rows) byConv.set(row.conversation_id, row);
    }

    let matched = 0;
    let updated = 0;
    const sample = [];

    for (const origin of origins) {
      const cid = origin.conversation_id;
      if (cid == null) continue;
      const first = byConv.get(cid);
      const hit = matchWeb(first?.body_text ?? '');
      if (!hit) continue;
      matched += 1;
      if (sample.length < 15) {
        sample.push({
          origin_id: origin.id,
          conversation_id: cid,
          slug: hit.slug,
          match: hit.match,
        });
      }
      if (!apply) continue;

      const externalId = `${hit.slug}:${cid}`.slice(0, 128);
      await prisma.$transaction(async (tx) => {
        const clash = await tx.contact_origins.findUnique({
          where: {
            area_channel_external_id: {
              area: origin.area,
              channel: 'web_button',
              external_id: externalId,
            },
          },
          select: { id: true },
        });
        const originId = clash?.id ?? origin.id;
        if (!clash) {
          await tx.contact_origins.update({
            where: { id: origin.id },
            data: {
              channel: 'web_button',
              external_id: externalId,
              source_key: hit.slug,
              source_label: hit.label.slice(0, 200),
              payload: {
                slug: hit.slug,
                match: hit.match,
                backfill: true,
              },
              updated_at: new Date(),
            },
          });
        }
        await tx.education_lead_entries.updateMany({
          where: { origin_id: origin.id, channel: 'organic_wa' },
          data: {
            channel: 'web_button',
            source_key: hit.slug,
            source_label: hit.label.slice(0, 200),
            ...(clash ? { origin_id: originId } : {}),
          },
        });
        if (clash && clash.id !== origin.id) {
          await tx.contact_origins.delete({ where: { id: origin.id } });
        }
      });
      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          apply,
          scanned: origins.length,
          matched,
          updated: apply ? updated : 0,
          sample,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
