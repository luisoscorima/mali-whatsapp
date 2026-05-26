(function () {
  function defaultState() {
    return {
      header: {
        type: 'none',
        text: '',
        exampleValues: [],
        exampleMediaUrl: '',
        exampleHandle: '',
      },
      body: {
        text: '',
        exampleValues: [],
      },
      footer: {
        text: '',
      },
      buttons: [],
    };
  }

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function parseState(root) {
    const script = root.querySelector('[data-template-builder-state]');
    if (!script) return defaultState();
    try {
      const parsed = JSON.parse(script.textContent || '{}');
      return {
        header: Object.assign({}, defaultState().header, parsed.header || {}),
        body: Object.assign({}, defaultState().body, parsed.body || {}),
        footer: Object.assign({}, defaultState().footer, parsed.footer || {}),
        buttons: Array.isArray(parsed.buttons)
          ? parsed.buttons.map(function (button) {
              return {
                type: 'url',
                text: String((button && button.text) || ''),
                url: String((button && button.url) || ''),
                exampleValues: Array.isArray(button && button.exampleValues) ? button.exampleValues.map(String) : [],
              };
            })
          : [],
      };
    } catch {
      return defaultState();
    }
  }

  function sanitizeAlias(raw) {
    var value = String(raw || '').trim().replace(/[^\w]+/g, '_');
    value = value.replace(/^_+/, '').replace(/_+/g, '_');
    if (/^\d/.test(value)) value = 'var_' + value;
    return value;
  }

  function extractPlaceholders(text) {
    var re = /\{\{([^{}]+)\}\}/g;
    var matches = [];
    var seen = Object.create(null);
    var match;
    while ((match = re.exec(String(text || ''))) !== null) {
      var token = String(match[1] || '').trim();
      if (!token || seen[token]) continue;
      seen[token] = true;
      matches.push(token);
    }
    return matches;
  }

  function labelForPlaceholder(token, idx) {
    if (/^\d+$/.test(token)) {
      return '{{' + token + '}}';
    }
    return token + ' ({{' + (idx + 1) + '}})';
  }

  function alignExampleValues(values, count) {
    var out = Array.isArray(values) ? values.slice(0, count) : [];
    while (out.length < count) out.push('');
    return out;
  }

  function renderExamples(prefix, placeholders, values) {
    if (!placeholders.length) {
      return '<p class="inline-help muted">Este bloque no requiere ejemplos porque no tiene variables.</p>';
    }
    var finalValues = alignExampleValues(values, placeholders.length);
    return placeholders
      .map(function (token, idx) {
        return (
          '<label class="field">' +
            '<span class="field-label">Ejemplo ' + esc(labelForPlaceholder(token, idx)) + '</span>' +
            '<input type="text" data-builder-example="' + esc(prefix) + '" data-builder-example-index="' + idx + '" value="' + esc(finalValues[idx] || '') + '" autocomplete="off" />' +
          '</label>'
        );
      })
      .join('');
  }

  function headerMediaLabel(type) {
    if (type === 'image') return 'URL pública de imagen de ejemplo';
    if (type === 'video') return 'URL pública de video de ejemplo';
    return 'URL pública de documento PDF de ejemplo';
  }

  function previewTokenLabel(token) {
    return '{{' + token + '}}';
  }

  function buildPreviewWarnings(state) {
    var warnings = [];
    var headerPlaceholders = extractPlaceholders(state.header.text);
    if (state.header.type === 'text' && headerPlaceholders.length > 1) {
      warnings.push('La cabecera de texto solo admite 1 variable.');
    }
    state.buttons.forEach(function (button, idx) {
      var placeholders = extractPlaceholders(button.url);
      if (placeholders.length > 1) {
        warnings.push('El botón URL ' + (idx + 1) + ' solo admite 1 variable.');
      } else if (placeholders.length === 1 && !/\}\}\s*$/.test(button.url || '')) {
        warnings.push('La variable del botón URL ' + (idx + 1) + ' debe ir al final.');
      }
    });
    return warnings;
  }

  function applyPreviewMode(text, exampleValues, mode) {
    var placeholders = extractPlaceholders(text);
    if (!placeholders.length) return String(text || '');
    var examples = alignExampleValues(exampleValues, placeholders.length);
    if (mode !== 'examples') return String(text || '');
    return String(text || '').replace(/\{\{([^{}]+)\}\}/g, function (_, token) {
      var clean = String(token || '').trim();
      var idx = placeholders.indexOf(clean);
      if (idx === -1) return '{{' + clean + '}}';
      return examples[idx] || '{{' + clean + '}}';
    });
  }

  function highlightPreviewText(text) {
    return esc(String(text || '')).replace(/\{\{[^{}]+\}\}/g, function (match) {
      return '<span class="template-live-preview__token">' + match + '</span>';
    }).replace(/\n/g, '<br />');
  }

  function renderPreviewText(text, exampleValues, mode) {
    return highlightPreviewText(applyPreviewMode(text, exampleValues, mode));
  }

  function summarizeUrl(url, exampleValues, mode) {
    var rendered = applyPreviewMode(url, exampleValues, mode);
    if (rendered.length <= 44) return rendered;
    return rendered.slice(0, 41) + '...';
  }

  function buildMappingItems(scopeLabel, text, exampleValues) {
    var placeholders = extractPlaceholders(text);
    var examples = alignExampleValues(exampleValues, placeholders.length);
    return placeholders.map(function (token, idx) {
      return {
        scope: scopeLabel,
        token: token,
        position: idx + 1,
        example: examples[idx] || '',
      };
    });
  }

  function builderShellHtml(state) {
    var headerType = String(state.header.type || 'none');
    var headerHtml = '';
    if (headerType === 'text') {
      headerHtml =
        '<label class="field">' +
          '<span class="field-label">Texto cabecera</span>' +
          '<textarea rows="2" data-builder-target="header-text" data-builder-header-text placeholder="Invitación para {{mes}}">' + esc(state.header.text || '') + '</textarea>' +
        '</label>' +
        '<div class="template-builder-inline-actions">' +
          '<button type="button" class="small-btn secondary" data-insert-variable="header-text">Añadir variable</button>' +
        '</div>' +
        '<div class="template-builder-examples" data-builder-examples-wrap="header"></div>';
    } else if (headerType !== 'none') {
      headerHtml =
        '<label class="field">' +
          '<span class="field-label">' + esc(headerMediaLabel(headerType)) + '</span>' +
          '<input type="url" data-builder-header-media-url placeholder="https://…" value="' + esc(state.header.exampleMediaUrl || '') + '" autocomplete="off" />' +
        '</label>' +
        '<p class="inline-help muted">Meta revisa este archivo para aprobar la plantilla. Debe ser accesible públicamente.</p>';
      if (state.header.exampleHandle) {
        headerHtml += '<p class="inline-help muted">Si no cambias la URL, se reutilizará el ejemplo media ya guardado localmente.</p>';
      }
    } else {
      headerHtml = '<p class="inline-help muted">La cabecera es opcional. Puedes usar texto o media.</p>';
    }

    var buttonsHtml = state.buttons.length
      ? state.buttons.map(function (button, idx) {
          return (
            '<div class="template-builder-button-card" data-builder-button="' + idx + '">' +
              '<div class="template-builder-button-card__head">' +
                '<strong>Botón URL ' + (idx + 1) + '</strong>' +
                '<button type="button" class="small-btn secondary" data-remove-button="' + idx + '">Quitar</button>' +
              '</div>' +
              '<label class="field">' +
                '<span class="field-label">Texto del botón</span>' +
                '<input type="text" data-builder-button-text="' + idx + '" maxlength="25" value="' + esc(button.text || '') + '" autocomplete="off" />' +
              '</label>' +
              '<label class="field">' +
                '<span class="field-label">URL</span>' +
                '<input type="text" data-builder-target="button-url-' + idx + '" data-builder-button-url="' + idx + '" placeholder="https://mali.pe/evento/{{codigo}}" value="' + esc(button.url || '') + '" autocomplete="off" />' +
              '</label>' +
              '<div class="template-builder-inline-actions">' +
                '<button type="button" class="small-btn secondary" data-insert-variable="button-url-' + idx + '">Añadir variable</button>' +
              '</div>' +
              '<div class="template-builder-examples" data-builder-examples-wrap="button-' + idx + '"></div>' +
            '</div>'
          );
        }).join('')
      : '<p class="inline-help muted">Puedes añadir hasta 2 botones URL con variables opcionales.</p>';

    return (
      '<div class="template-builder-grid">' +
        '<section class="template-builder-section">' +
          '<div class="campaign-step-head">' +
            '<span class="campaign-step-badge campaign-step-badge--compact" aria-hidden="true">1</span>' +
            '<span class="campaign-segments-titleline">Cabecera</span>' +
          '</div>' +
          '<label class="field">' +
            '<span class="field-label">Tipo de cabecera</span>' +
            '<select data-builder-header-type>' +
              '<option value="none"' + (headerType === 'none' ? ' selected' : '') + '>Sin cabecera</option>' +
              '<option value="text"' + (headerType === 'text' ? ' selected' : '') + '>Texto</option>' +
              '<option value="image"' + (headerType === 'image' ? ' selected' : '') + '>Imagen</option>' +
              '<option value="video"' + (headerType === 'video' ? ' selected' : '') + '>Video</option>' +
              '<option value="document"' + (headerType === 'document' ? ' selected' : '') + '>Documento</option>' +
            '</select>' +
          '</label>' +
          headerHtml +
        '</section>' +
        '<section class="template-builder-section">' +
          '<div class="campaign-step-head">' +
            '<span class="campaign-step-badge campaign-step-badge--compact" aria-hidden="true">2</span>' +
            '<span class="campaign-segments-titleline">Cuerpo</span>' +
          '</div>' +
          '<label class="field">' +
            '<span class="field-label">Texto cuerpo</span>' +
            '<textarea rows="6" data-builder-target="body-text" data-builder-body-text placeholder="Hola {{nombre}}, te esperamos el {{fecha}} a las {{horario}}.">' + esc(state.body.text || '') + '</textarea>' +
          '</label>' +
          '<div class="template-builder-inline-actions">' +
            '<button type="button" class="small-btn secondary" data-insert-variable="body-text">Añadir variable</button>' +
          '</div>' +
          '<div class="template-builder-examples" data-builder-examples-wrap="body"></div>' +
        '</section>' +
        '<section class="template-builder-section">' +
          '<div class="campaign-step-head">' +
            '<span class="campaign-step-badge campaign-step-badge--compact" aria-hidden="true">3</span>' +
            '<span class="campaign-segments-titleline">Pie (opcional)</span>' +
          '</div>' +
          '<label class="field">' +
            '<span class="field-label">Texto pie</span>' +
            '<input type="text" data-builder-footer-text maxlength="60" placeholder="Cupos limitados." value="' + esc(state.footer.text || '') + '" autocomplete="off" />' +
          '</label>' +
          '<p class="inline-help muted">El pie no admite variables.</p>' +
        '</section>' +
        '<section class="template-builder-section">' +
          '<div class="campaign-step-head">' +
            '<span class="campaign-step-badge campaign-step-badge--compact" aria-hidden="true">4</span>' +
            '<span class="campaign-segments-titleline">Botones URL</span>' +
          '</div>' +
          buttonsHtml +
          '<div class="template-builder-inline-actions">' +
            '<button type="button" class="small-btn secondary" data-add-button ' + (state.buttons.length >= 2 ? 'disabled' : '') + '>Añadir botón URL</button>' +
          '</div>' +
        '</section>' +
      '</div>'
    );
  }

  function previewShellHtml(state, mode) {
    var previewMode = mode === 'examples' ? 'examples' : 'aliases';
    var headerType = String(state.header.type || 'none');
    var mappingItems = [];
    var warnings = buildPreviewWarnings(state);

    if (headerType === 'text') {
      mappingItems = mappingItems.concat(buildMappingItems('Cabecera', state.header.text, state.header.exampleValues));
    }
    mappingItems = mappingItems.concat(buildMappingItems('Cuerpo', state.body.text, state.body.exampleValues));
    state.buttons.forEach(function (button, idx) {
      mappingItems = mappingItems.concat(buildMappingItems('Botón ' + (idx + 1), button.url, button.exampleValues));
    });

    var headerPreviewHtml = '';
    if (headerType === 'text' && state.header.text) {
      headerPreviewHtml =
        '<div class="template-live-preview__header-text">' +
          renderPreviewText(state.header.text, state.header.exampleValues, previewMode) +
        '</div>';
    } else if (headerType === 'image') {
      if (state.header.exampleMediaUrl) {
        headerPreviewHtml =
          '<div class="template-live-preview__media template-live-preview__media--image">' +
            '<img src="' + esc(state.header.exampleMediaUrl) + '" alt="Imagen de cabecera" loading="lazy" />' +
          '</div>';
      } else {
        headerPreviewHtml =
          '<div class="template-live-preview__media template-live-preview__media--placeholder">' +
            '<span class="badge neutral">IMAGE</span><span>Imagen de cabecera</span>' +
          '</div>';
      }
    } else if (headerType === 'video' || headerType === 'document') {
      headerPreviewHtml =
        '<div class="template-live-preview__media template-live-preview__media--placeholder">' +
          '<span class="badge neutral">' + esc(headerType.toUpperCase()) + '</span><span>' + esc(headerType === 'video' ? 'Video de cabecera' : 'Documento de cabecera') + '</span>' +
        '</div>';
    }

    var bodyPreviewHtml = state.body.text
      ? '<div class="template-live-preview__body">' + renderPreviewText(state.body.text, state.body.exampleValues, previewMode) + '</div>'
      : '<div class="template-live-preview__body template-live-preview__body--empty">Empieza a escribir el cuerpo para ver la vista previa.</div>';

    var footerPreviewHtml = state.footer.text
      ? '<div class="template-live-preview__footer">' + esc(state.footer.text) + '</div>'
      : '';

    var buttonsPreviewHtml = state.buttons.length
      ? '<div class="template-live-preview__buttons">' +
          state.buttons.map(function (button) {
            return (
              '<button type="button" class="template-live-preview__button" tabindex="-1">' +
                '<span class="template-live-preview__button-text">' + esc(button.text || 'Botón URL') + '</span>' +
                (button.url
                  ? '<span class="template-live-preview__button-url">' + esc(summarizeUrl(button.url, button.exampleValues, previewMode)) + '</span>'
                  : '') +
              '</button>'
            );
          }).join('') +
        '</div>'
      : '';

    var mappingHtml = mappingItems.length
      ? '<div class="template-live-preview__meta-card">' +
          '<h4 class="template-live-preview__meta-title">Mapeo interno</h4>' +
          '<ul class="template-live-preview__meta-list">' +
            mappingItems.map(function (item) {
              return (
                '<li>' +
                  '<span class="template-live-preview__meta-scope">' + esc(item.scope) + '</span>' +
                  '<span><code>' + esc(previewTokenLabel(item.token)) + '</code> → <code>{{' + item.position + '}}</code>' +
                  (item.example ? ' · ej. ' + esc(item.example) : '') +
                  '</span>' +
                '</li>'
              );
            }).join('') +
          '</ul>' +
        '</div>'
      : '';

    var warningsHtml = warnings.length
      ? '<div class="template-live-preview__meta-card template-live-preview__meta-card--warn">' +
          '<h4 class="template-live-preview__meta-title">Avisos</h4>' +
          '<ul class="template-live-preview__meta-list">' +
            warnings.map(function (warning) {
              return '<li>' + esc(warning) + '</li>';
            }).join('') +
          '</ul>' +
        '</div>'
      : '';

    return (
      '<div class="template-live-preview__sticky">' +
        '<div class="template-live-preview__head">' +
          '<div>' +
            '<h3 class="card-title">Vista previa</h3>' +
            '<p class="inline-help muted template-live-preview__subtitle">Editorial / no exacta a Meta</p>' +
          '</div>' +
          '<div class="template-live-preview__toggle" role="tablist" aria-label="Modo de vista previa">' +
            '<button type="button" class="small-btn ' + (previewMode === 'aliases' ? 'primary' : 'secondary') + '" data-preview-mode="aliases" aria-pressed="' + (previewMode === 'aliases' ? 'true' : 'false') + '">Aliases</button>' +
            '<button type="button" class="small-btn ' + (previewMode === 'examples' ? 'primary' : 'secondary') + '" data-preview-mode="examples" aria-pressed="' + (previewMode === 'examples' ? 'true' : 'false') + '">Ejemplo</button>' +
          '</div>' +
        '</div>' +
        '<div class="template-live-preview__phone">' +
          '<div class="template-live-preview__screen">' +
            '<div class="template-live-preview__message">' +
              headerPreviewHtml +
              bodyPreviewHtml +
              footerPreviewHtml +
              buttonsPreviewHtml +
            '</div>' +
          '</div>' +
        '</div>' +
        '<details class="template-live-preview__details" open>' +
          '<summary>Detalles</summary>' +
          mappingHtml +
          warningsHtml +
        '</details>' +
      '</div>'
    );
  }

  function readStateFromDom(root) {
    var prev = root.__templateBuilderState || defaultState();
    var next = defaultState();
    var headerTypeEl = root.querySelector('[data-builder-header-type]');
    next.header.type = headerTypeEl ? String(headerTypeEl.value || 'none') : 'none';
    next.header.exampleHandle = prev.header.exampleHandle || '';

    var headerText = root.querySelector('[data-builder-header-text]');
    if (headerText) {
      next.header.text = headerText.value || '';
      next.header.exampleValues = Array.prototype.map.call(
        root.querySelectorAll('[data-builder-example="header"]'),
        function (el) { return el.value || ''; }
      );
    }

    var headerMediaUrl = root.querySelector('[data-builder-header-media-url]');
    if (headerMediaUrl) next.header.exampleMediaUrl = headerMediaUrl.value || '';

    var bodyText = root.querySelector('[data-builder-body-text]');
    next.body.text = bodyText ? bodyText.value || '' : '';
    next.body.exampleValues = Array.prototype.map.call(
      root.querySelectorAll('[data-builder-example="body"]'),
      function (el) { return el.value || ''; }
    );

    var footerText = root.querySelector('[data-builder-footer-text]');
    next.footer.text = footerText ? footerText.value || '' : '';

    var buttonCards = root.querySelectorAll('[data-builder-button]');
    buttonCards.forEach(function (card) {
      var idx = Number(card.getAttribute('data-builder-button'));
      var textEl = root.querySelector('[data-builder-button-text="' + idx + '"]');
      var urlEl = root.querySelector('[data-builder-button-url="' + idx + '"]');
      next.buttons.push({
        type: 'url',
        text: textEl ? textEl.value || '' : '',
        url: urlEl ? urlEl.value || '' : '',
        exampleValues: Array.prototype.map.call(
          root.querySelectorAll('[data-builder-example="button-' + idx + '"]'),
          function (el) { return el.value || ''; }
        ),
      });
    });

    root.__templateBuilderState = next;
    return next;
  }

  function renderExampleBlocks(root, state) {
    var headerWrap = root.querySelector('[data-builder-examples-wrap="header"]');
    if (headerWrap) {
      var headerPlaceholders = extractPlaceholders(state.header.text);
      headerWrap.innerHTML = renderExamples('header', headerPlaceholders, state.header.exampleValues);
      if (headerPlaceholders.length > 1) {
        headerWrap.innerHTML += '<p class="inline-warn">La cabecera de texto solo admite 1 variable.</p>';
      }
    }

    var bodyWrap = root.querySelector('[data-builder-examples-wrap="body"]');
    if (bodyWrap) {
      bodyWrap.innerHTML = renderExamples('body', extractPlaceholders(state.body.text), state.body.exampleValues);
    }

    state.buttons.forEach(function (button, idx) {
      var wrap = root.querySelector('[data-builder-examples-wrap="button-' + idx + '"]');
      if (!wrap) return;
      var placeholders = extractPlaceholders(button.url);
      wrap.innerHTML = renderExamples('button-' + idx, placeholders, button.exampleValues);
      if (placeholders.length > 1) {
        wrap.innerHTML += '<p class="inline-warn">Cada botón URL admite solo 1 variable.</p>';
      } else if (placeholders.length === 1 && !/\}\}\s*$/.test(button.url || '')) {
        wrap.innerHTML += '<p class="inline-warn">La variable del botón URL debe ir al final de la URL.</p>';
      }
    });
  }

  function renderPreview(root, state) {
    var previewShell = root.querySelector('[data-template-preview-shell]');
    if (!root.__templatePreviewMode) root.__templatePreviewMode = 'aliases';
    if (previewShell) {
      previewShell.innerHTML = previewShellHtml(state, root.__templatePreviewMode);
    }
  }

  function render(root, state) {
    var shell = root.querySelector('[data-template-builder-shell]');
    if (!shell) return;
    root.__templateBuilderState = state;
    shell.innerHTML = builderShellHtml(state);
    renderPreview(root, state);
    renderExampleBlocks(root, state);
  }

  function insertPlaceholder(target, alias) {
    if (!target) return;
    var snippet = '{{' + alias + '}}';
    var start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
    var end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;
    var before = String(target.value || '').slice(0, start);
    var after = String(target.value || '').slice(end);
    target.value = before + snippet + after;
    if (typeof target.focus === 'function') target.focus();
    if (typeof target.setSelectionRange === 'function') {
      var pos = start + snippet.length;
      target.setSelectionRange(pos, pos);
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function bind(root) {
    root.addEventListener('change', function (ev) {
      if (ev.target && ev.target.matches('[data-builder-header-type]')) {
        var state = readStateFromDom(root);
        state.header.type = String(ev.target.value || 'none');
        render(root, state);
        return;
      }
      readStateFromDom(root);
    });

    root.addEventListener('input', function () {
      var state = readStateFromDom(root);
      renderPreview(root, state);
      renderExampleBlocks(root, state);
    });

    root.addEventListener('click', function (ev) {
      var previewModeBtn = ev.target.closest('[data-preview-mode]');
      if (previewModeBtn) {
        ev.preventDefault();
        root.__templatePreviewMode = previewModeBtn.getAttribute('data-preview-mode') === 'examples' ? 'examples' : 'aliases';
        render(root, readStateFromDom(root));
        return;
      }

      var addBtn = ev.target.closest('[data-add-button]');
      if (addBtn) {
        ev.preventDefault();
        var state = readStateFromDom(root);
        if (state.buttons.length >= 2) return;
        state.buttons.push({ type: 'url', text: '', url: '', exampleValues: [] });
        render(root, state);
        return;
      }

      var removeBtn = ev.target.closest('[data-remove-button]');
      if (removeBtn) {
        ev.preventDefault();
        var removeState = readStateFromDom(root);
        var removeIdx = Number(removeBtn.getAttribute('data-remove-button'));
        removeState.buttons = removeState.buttons.filter(function (_, idx) { return idx !== removeIdx; });
        render(root, removeState);
        return;
      }

      var insertBtn = ev.target.closest('[data-insert-variable]');
      if (insertBtn) {
        ev.preventDefault();
        var alias = window.prompt('Nombre de la variable (solo letras, números y guion bajo):', 'fecha');
        alias = sanitizeAlias(alias);
        if (!alias) {
          window.alert('Ingresa un nombre válido, por ejemplo: fecha, horario o mes.');
          return;
        }
        var targetKey = insertBtn.getAttribute('data-insert-variable');
        var target = root.querySelector('[data-builder-target="' + targetKey + '"]');
        insertPlaceholder(target, alias);
      }
    });

    root.addEventListener('submit', function () {
      var payloadInput = root.querySelector('[data-template-builder-payload]');
      if (!payloadInput) return;
      payloadInput.value = JSON.stringify(readStateFromDom(root));
    });
  }

  document.querySelectorAll('[data-template-builder-root]').forEach(function (root) {
    var state = parseState(root);
    render(root, state);
    bind(root);
  });
})();
