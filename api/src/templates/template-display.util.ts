export type TemplateButtonDisplay = {
  type: string;
  text: string;
  url: string;
};

export type TemplateDisplayContent = {
  headerText: string;
  headerFormat: string;
  bodyText: string;
  footerText: string;
  buttons: TemplateButtonDisplay[];
  bodyExamples: string[];
};

export function extractTemplateDisplayContent(
  components: unknown,
): TemplateDisplayContent {
  const comps = Array.isArray(components) ? components : [];
  let headerText = '';
  let headerFormat = '';
  let bodyText = '';
  let footerText = '';
  const buttons: TemplateButtonDisplay[] = [];
  let bodyExamples: string[] = [];

  for (const raw of comps) {
    const c = raw as Record<string, unknown>;
    const type = String(c.type || '').toUpperCase();
    if (type === 'HEADER') {
      headerFormat = String(c.format || 'TEXT').toUpperCase();
      headerText = String(c.text || '');
    }
    if (type === 'BODY') {
      bodyText = String(c.text || '');
      const example = c.example as
        | { body_text?: string[][] }
        | undefined;
      if (example?.body_text?.[0]) {
        bodyExamples = example.body_text[0];
      }
    }
    if (type === 'FOOTER') {
      footerText = String(c.text || '');
    }
    if (type === 'BUTTONS' && Array.isArray(c.buttons)) {
      for (const btn of c.buttons) {
        const b = btn as Record<string, unknown>;
        buttons.push({
          type: String(b.type || ''),
          text: String(b.text || ''),
          url: String(b.url || ''),
        });
      }
    }
  }

  return {
    headerText,
    headerFormat,
    bodyText,
    footerText,
    buttons,
    bodyExamples,
  };
}
