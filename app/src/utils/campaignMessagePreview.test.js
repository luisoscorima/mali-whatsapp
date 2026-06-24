const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateDefinition } = require('../services/templateParser');
const { buildCampaignMessagePreview } = require('../services/campaignMessagePreview');
const { formatWhatsAppHtml } = require('./whatsappTextFormat');

test('buildCampaignMessagePreview sustituye parámetros personalizados', () => {
  const components = [
    { type: 'HEADER', format: 'TEXT', text: 'Potencia tu forma de comunicar con Storytelling Estratégico' },
    {
      type: 'BODY',
      text: '*Hola, {{1}}* 👋\n\nTe escribimos desde MALI porque recibimos tu solicitud sobre *{{2}}.*',
    },
    { type: 'FOOTER', text: 'MALI Extensión Profesional' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Quiero inscribirme' },
        { type: 'QUICK_REPLY', text: 'Tengo dudas' },
      ],
    },
  ];
  const def = buildTemplateDefinition({ components_json: components });
  const { preview, bodyTextForSearch } = buildCampaignMessagePreview(def, components, {
    headerParams: [],
    bodyParams: ['Luis', 'Storytelling Estratégico'],
    buttonParams: [],
  });

  assert.equal(
    preview.headerText,
    'Potencia tu forma de comunicar con Storytelling Estratégico'
  );
  assert.match(preview.bodyText, /Hola, Luis/);
  assert.match(preview.bodyText, /Storytelling Estratégico/);
  assert.equal(preview.footerText, 'MALI Extensión Profesional');
  assert.equal(preview.buttons.length, 2);
  assert.equal(preview.buttons[0].text, 'Quiero inscribirme');
  assert.match(bodyTextForSearch, /Potencia tu forma/);
});

test('formatWhatsAppHtml convierte negrita y saltos de línea', () => {
  const html = formatWhatsAppHtml('*Hola*\n_mundo_');
  assert.match(html, /<strong>Hola<\/strong>/);
  assert.match(html, /<em>mundo<\/em>/);
  assert.match(html, /<br \/>/);
});

test('parseStaticParamsFromMessageText reconstruye parámetros legacy', () => {
  const { parseStaticParamsFromMessageText } = require('../services/campaignMessagePreview');
  const components = [
    { type: 'HEADER', format: 'IMAGE', text: '' },
    {
      type: 'BODY',
      text: 'Hola {{1}}, curso {{2}}',
    },
  ];
  const def = buildTemplateDefinition({ components_json: components });
  const params = parseStaticParamsFromMessageText(
    def,
    'media:https://example.com/img.jpg | Ana | Storytelling',
    null
  );
  assert.equal(params.headerMediaUrl, 'https://example.com/img.jpg');
  assert.deepEqual(params.bodyParams, ['Ana', 'Storytelling']);
});

test('buildSendContextFromCampaign usa message_text si falta payload', () => {
  const { buildSendContextFromCampaign } = require('../services/campaignSendContext');
  const components = [{ type: 'BODY', text: 'Hola {{1}}' }];
  const templateRow = {
    id: 1,
    name: 'leads_storytelling',
    language: 'es',
    category: 'MARKETING',
    components_json: components,
  };
  const ctx = buildSendContextFromCampaign(
    {
      template_name: 'leads_storytelling',
      message_text: 'Luis',
      image_url: null,
      campaign_payload: null,
    },
    templateRow
  );
  assert.ok(ctx);
  assert.deepEqual(ctx.staticParams.bodyParams, ['Luis']);
});

test('applyCampaignImageFallback usa campaigns.image_url', () => {
  const { applyCampaignImageFallback } = require('../services/campaignMessagePreview');
  const preview = {
    headerMediaType: 'image',
    headerMediaUrl: null,
    bodyText: 'Hola',
  };
  const next = applyCampaignImageFallback(preview, 'https://cdn.example/banner.jpg');
  assert.equal(next.headerMediaUrl, 'https://cdn.example/banner.jpg');
});

test('buildDetailPreviewParams muestra etiquetas para parámetros dinámicos', () => {
  const { buildDetailPreviewParams } = require('../services/campaignMessagePreview');
  const params = buildDetailPreviewParams(
    {
      headerParams: [],
      bodyParams: [''],
      buttonParams: [],
      headerMediaUrl: '',
    },
    {
      headerParams: [],
      bodyParams: ['contact.name'],
      buttonParams: [],
    }
  );
  assert.deepEqual(params.bodyParams, ['[Nombre del contacto]']);
});

test('buildCampaignDetailPreviewFromRow resuelve preview y templateId', () => {
  const { buildCampaignDetailPreviewFromRow } = require('../services/campaignMessagePreview');
  const components = [
    { type: 'BODY', text: 'Hola {{1}}' },
    { type: 'FOOTER', text: 'MALI' },
  ];
  const result = buildCampaignDetailPreviewFromRow(
    {
      template_name: 'leads_storytelling',
      message_text: '',
      image_url: null,
      campaign_payload: {
        templateSnapshot: {
          id: 42,
          name: 'leads_storytelling',
          language: 'es',
          category: 'MARKETING',
          components_json: components,
        },
        staticParams: {
          headerParams: [],
          bodyParams: [''],
          buttonParams: [],
        },
        paramMapping: {
          headerParams: [],
          bodyParams: ['contact.name'],
          buttonParams: [],
        },
      },
    },
    null
  );
  assert.equal(result.templateId, 42);
  assert.match(result.preview.bodyText, /\[Nombre del contacto\]/);
  assert.equal(result.preview.footerText, 'MALI');
});
