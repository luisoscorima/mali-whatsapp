(function () {
  const select = document.getElementById('template-sync-select');
  const container = document.getElementById('dynamic-template-fields');
  const form = document.getElementById('campaign-form');
  if (!select || !container || !form) return;

  const basePath = form.getAttribute('data-base-path') || '';

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function buildFields(def) {
    const parts = [];
    parts.push('<span class="form-section-label">Contenido de la plantilla</span>');

    if (def.needsHeaderMedia) {
      const label =
        def.headerMedia === 'IMAGE'
          ? 'URL imagen (cabecera)'
          : def.headerMedia === 'VIDEO'
            ? 'URL video (cabecera)'
            : 'URL documento (cabecera)';
      parts.push(
        '<label class="field">' +
          '<span class="field-label">' +
          esc(label) +
          '</span>' +
          '<input type="url" name="headerMediaUrl" required placeholder="https://…" autocomplete="off" />' +
          '</label>'
      );
    }

    for (let i = 0; i < def.headerTextSlotCount; i++) {
      parts.push(
        '<label class="field">' +
          '<span class="field-label">Texto cabecera (' +
          (i + 1) +
          ')</span>' +
          '<input type="text" name="headerParam_' +
          i +
          '" required maxlength="1024" autocomplete="off" />' +
          '</label>'
      );
    }

    for (let i = 0; i < def.bodySlotCount; i++) {
      parts.push(
        '<label class="field">' +
          '<span class="field-label">Texto cuerpo (' +
          (i + 1) +
          ')</span>' +
          '<input type="text" name="bodyParam_' +
          i +
          '" required maxlength="1024" autocomplete="off" />' +
          '</label>'
      );
    }

    for (let i = 0; i < def.totalButtonParams; i++) {
      parts.push(
        '<label class="field">' +
          '<span class="field-label">Botón URL (' +
          (i + 1) +
          ')</span>' +
          '<input type="text" name="buttonParam_' +
          i +
          '" required maxlength="1024" autocomplete="off" />' +
          '</label>'
      );
    }

    if (parts.length === 1) {
      parts.push('<p class="muted">Esta plantilla no requiere parámetros variables.</p>');
    }

    container.innerHTML = '<div class="form-grid tight">' + parts.join('') + '</div>';
    container.hidden = false;
  }

  async function loadDefinition(id) {
    if (!id) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    container.innerHTML = '<p class="muted">Cargando…</p>';
    container.hidden = false;
    try {
      const url = basePath + '/api/templates/' + encodeURIComponent(id) + '/definition';
      const r = await fetch(url, { credentials: 'same-origin' });
      const data = await r.json();
      if (!data.ok || !data.definition) {
        container.innerHTML = '<p class="inline-warn">No se pudo cargar la plantilla.</p>';
        return;
      }
      buildFields(data.definition);
    } catch (e) {
      container.innerHTML = '<p class="inline-warn">Error al cargar la definición.</p>';
    }
  }

  select.addEventListener('change', function () {
    loadDefinition(select.value);
  });

  if (select.value) {
    loadDefinition(select.value);
  }
})();
