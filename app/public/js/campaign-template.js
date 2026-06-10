(function () {
  const select = document.getElementById('template-sync-select');
  const container = document.getElementById('dynamic-template-fields');
  const form = document.getElementById('campaign-form');
  if (!form) return;

  const basePath = form.getAttribute('data-base-path') || '';
  const loadRecipientsBtn = document.getElementById('campaign-load-recipients');
  const recipientsListEl = document.getElementById('campaign-recipients-list');
  const recipientsToolbar = document.getElementById('campaign-recipients-toolbar');
  const recipientsStatus = document.getElementById('campaign-recipients-status');
  const recipientsCountEl = document.getElementById('campaign-recipients-count');
  const selectAllBtn = document.getElementById('campaign-select-all');
  const selectNoneBtn = document.getElementById('campaign-select-none');
  const submitBtn = document.getElementById('campaign-submit-btn');
  const submitWrap = document.getElementById('campaign-submit-wrap');
  const submitHintEl = document.getElementById('campaign-submit-hint');
  const sendErrorEl = document.getElementById('campaign-send-error');
  const scheduleWrap = document.getElementById('campaign-schedule-datetime-wrap');
  const scheduledAtInput = document.getElementById('campaign-scheduled-at');

  let recipientsLoaded = false;
  let templateDefinitionReady = false;
  let templateLoadRequestId = 0;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function ensureToastHost() {
    let host = document.getElementById('campaign-toast-stack');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'campaign-toast-stack';
    host.className = 'campaign-toast-stack';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    const card = form.closest('.card');
    if (card) {
      card.insertBefore(host, form);
    } else {
      form.parentNode.insertBefore(host, form);
    }
    return host;
  }

  function showCampaignToast(message, type) {
    const msg = String(message || '').trim();
    if (!msg) return;
    const host = ensureToastHost();
    while (host.children.length >= 3) {
      host.removeChild(host.firstElementChild);
    }
    const toast = document.createElement('p');
    const kind = type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : 'err';
    toast.className = 'toast toast--' + kind + ' campaign-toast';
    toast.textContent = msg;
    host.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, kind === 'err' ? 9000 : 6500);
  }

  function getCheckedSegments() {
    return Array.prototype.map.call(form.querySelectorAll('input[name="campaignSegment"]:checked'), function (el) {
      return el.value;
    });
  }

  function getCheckedExcludeSegments() {
    return Array.prototype.map.call(
      form.querySelectorAll('input[name="campaignExcludeSegment"]:checked'),
      function (el) {
        return el.value;
      }
    );
  }

  let paramSourceOptions = [
    { value: 'static', label: 'Valor fijo (campo de arriba)' },
    { value: 'contact.name', label: 'Nombre del contacto' },
    { value: 'contact.phone', label: 'Teléfono del contacto' },
  ];

  function hasParamSourceOption(value) {
    return paramSourceOptions.some(function (opt) {
      return opt.value === value;
    });
  }

  function paramSourceOptionsHtml(selectedValue) {
    return paramSourceOptions
      .map(function (o) {
        const selected = o.value === selectedValue ? ' selected' : '';
        return '<option value="' + esc(o.value) + '"' + selected + '>' + esc(o.label) + '</option>';
      })
      .join('');
  }

  function paramSourceSelectHtml(name) {
    return (
      '<label class="field field--compact">' +
      '<span class="field-label">Origen del valor</span>' +
      '<select name="' +
      esc(name) +
      '" class="campaign-param-source">' +
      paramSourceOptionsHtml('static') +
      '</select></label>'
    );
  }

  function syncParamRows(root) {
    if (!root) return;
    root.querySelectorAll('.campaign-param-row').forEach(function (row) {
      const input = row.querySelector('.campaign-param-input');
      const sourceSelect = row.querySelector('.campaign-param-source');
      const help = row.querySelector('.campaign-param-help');
      if (!input || !sourceSelect) return;

      const source = String(sourceSelect.value || 'static').trim() || 'static';
      const selectedOption = sourceSelect.options[sourceSelect.selectedIndex];
      const label = selectedOption ? String(selectedOption.text || '').trim() : 'valor por contacto';
      const isStatic = source === 'static';

      if (isStatic) {
        input.disabled = false;
        input.readOnly = false;
        input.required = true;
        input.placeholder = input.getAttribute('data-static-placeholder') || '';
        if (!input.value && input.dataset.staticValue) {
          input.value = input.dataset.staticValue;
        }
        if (help) {
          help.textContent = 'Escribe el dato fijo que se enviará igual para todos los destinatarios.';
        }
        return;
      }

      if (!input.disabled) {
        input.dataset.staticValue = input.value;
      }
      input.value = '';
      input.disabled = true;
      input.readOnly = true;
      input.required = false;
      input.placeholder = 'Se completará automáticamente con ' + label.toLowerCase() + '.';
      if (help) {
        help.textContent = 'Cada destinatario usará su propio valor de ' + label.toLowerCase() + '.';
      }
    });
  }

  function refreshParamSourceSelects() {
    if (!container) return;
    container.querySelectorAll('.campaign-param-source').forEach(function (selectEl) {
      const current = String(selectEl.value || 'static').trim() || 'static';
      const nextValue = hasParamSourceOption(current) ? current : 'static';
      selectEl.innerHTML = paramSourceOptionsHtml(nextValue);
    });
    syncParamRows(container);
  }

  function getCheckedRecipientIds() {
    if (!recipientsListEl) return [];
    const boxes = recipientsListEl.querySelectorAll('input[name="recipientContact"]:checked');
    return Array.prototype.map.call(boxes, function (el) {
      return Number(el.value);
    }).filter(function (n) {
      return Number.isInteger(n) && n > 0;
    });
  }

  function formatBackendError(raw, status) {
    const msg = String(raw || '').trim();
    if (!msg) {
      return status >= 500
        ? 'Error del servidor al enviar. Revisa los datos e inténtalo de nuevo.'
        : 'No se pudo enviar la campaña.';
    }
    if (/^Envío rechazado:/i.test(msg)) return msg;
    return 'Envío rechazado: ' + msg;
  }

  function showSendError(msg, status) {
    const formatted = msg ? formatBackendError(msg, status || 400) : '';
    if (sendErrorEl) {
      if (formatted) {
        sendErrorEl.textContent = formatted;
        sendErrorEl.hidden = false;
      } else {
        sendErrorEl.textContent = '';
        sendErrorEl.hidden = true;
      }
    }
    if (formatted) {
      showCampaignToast(formatted, 'err');
      if (status >= 500) {
        console.error('Campaign send failed:', msg);
      }
    }
  }

  function getSubmitBlockers() {
    const blockers = [];

    if (submitBtn && submitBtn.hasAttribute('data-disabled-by-server')) {
      blockers.push('Faltan segmentos o plantillas aprobadas. Revisa la configuración inicial de la campaña.');
      return blockers;
    }

    if (!getCheckedSegments().length) {
      blockers.push('Paso 1 — Segmentos: marca al menos un segmento.');
    }

    if (!recipientsLoaded) {
      blockers.push('Paso 2 — Destinatarios: pulsa "Mostrar destinatarios".');
    } else if (getCheckedRecipientIds().length === 0) {
      blockers.push('Paso 2 — Destinatarios: selecciona al menos un contacto.');
    }

    if (!select || !select.value) {
      blockers.push('Paso 3 — Plantilla: elige una plantilla sincronizada.');
    } else if (!templateDefinitionReady) {
      blockers.push('Paso 3 — Plantilla: espera a que cargue la definición.');
    }

    const scheduleMode = form.querySelector('input[name="scheduleMode"]:checked');
    if (scheduleMode && scheduleMode.value === 'scheduled') {
      const dt = scheduledAtInput && String(scheduledAtInput.value || '').trim();
      if (!dt) {
        blockers.push('Paso 4 — Cuándo enviar: indica fecha y hora de programación.');
      }
    }

    return blockers;
  }

  function updateSubmitHint(blockers) {
    if (!submitHintEl) return;
    if (!blockers.length) {
      submitHintEl.textContent = '';
      submitHintEl.hidden = true;
      return;
    }
    submitHintEl.textContent = blockers.length === 1 ? blockers[0] : blockers.join(' · ');
    submitHintEl.hidden = false;
  }

  function scrollToFirstBlocker() {
    const blockers = getSubmitBlockers();
    if (!blockers.length) return;

    if (blockers.some(function (b) {
      return b.indexOf('Paso 1') === 0;
    })) {
      const el = form.querySelector('.campaign-segments-panel');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    if (blockers.some(function (b) {
      return b.indexOf('Paso 2') === 0;
    })) {
      const el = document.querySelector('.campaign-destinatarios-block');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    if (blockers.some(function (b) {
      return b.indexOf('Paso 3') === 0;
    })) {
      const el = form.querySelector('.campaign-template-head') || container;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    if (blockers.some(function (b) {
      return b.indexOf('Paso 4') === 0;
    })) {
      const el = form.querySelector('.form-section--schedule') || scheduleWrap;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function showSubmitBlockersToasts(blockers) {
    blockers.forEach(function (msg, i) {
      window.setTimeout(function () {
        showCampaignToast(msg, 'warn');
      }, i * 450);
    });
  }

  function updateSubmitEnabled() {
    if (!submitBtn) return;
    const blockers = getSubmitBlockers();
    const disabled = blockers.length > 0;
    submitBtn.disabled = disabled;
    updateSubmitHint(blockers);
    if (submitWrap) {
      submitWrap.classList.toggle('is-blocked', disabled);
      submitWrap.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
  }

  function updateRecipientCount() {
    if (!recipientsCountEl || !recipientsListEl) return;
    const total = recipientsListEl.querySelectorAll('input[name="recipientContact"]').length;
    const checked = getCheckedRecipientIds().length;
    recipientsCountEl.textContent = total ? checked + ' / ' + total + ' seleccionados' : '';
    updateSubmitEnabled();
  }

  function buildFields(def) {
    const parts = [];
    parts.push('<span class="form-section-label">Contenido de la plantilla</span>');
    const headerDefs = Array.isArray(def.headerParamDefs) ? def.headerParamDefs : [];
    const bodyDefs = Array.isArray(def.bodyParamDefs) ? def.bodyParamDefs : [];
    const buttonDefs = Array.isArray(def.buttonParamDefs) ? def.buttonParamDefs : [];

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
      const meta = headerDefs[i];
      const label = meta && meta.label ? meta.label : 'Texto cabecera (' + (i + 1) + ')';
      parts.push(
        '<div class="campaign-param-row">' +
          '<label class="field">' +
          '<span class="field-label">' +
          esc(label) +
          '</span>' +
          '<input type="text" name="headerParam_' +
          i +
          '" class="campaign-param-input" required maxlength="1024" autocomplete="off" data-static-placeholder="Dato fijo para todos los destinatarios" />' +
          '<span class="inline-help campaign-param-help">Escribe el dato fijo que se enviará igual para todos los destinatarios.</span>' +
          '</label>' +
          paramSourceSelectHtml('headerParamSource_' + i) +
          '</div>'
      );
    }

    for (let i = 0; i < def.bodySlotCount; i++) {
      const meta = bodyDefs[i];
      const label = meta && meta.label ? meta.label : 'Texto cuerpo (' + (i + 1) + ')';
      parts.push(
        '<div class="campaign-param-row">' +
          '<label class="field">' +
          '<span class="field-label">' +
          esc(label) +
          '</span>' +
          '<input type="text" name="bodyParam_' +
          i +
          '" class="campaign-param-input" required maxlength="1024" autocomplete="off" data-static-placeholder="Dato fijo para todos los destinatarios" />' +
          '<span class="inline-help campaign-param-help">Escribe el dato fijo que se enviará igual para todos los destinatarios.</span>' +
          '</label>' +
          paramSourceSelectHtml('bodyParamSource_' + i) +
          '</div>'
      );
    }

    for (let i = 0; i < def.totalButtonParams; i++) {
      const meta = buttonDefs[i];
      const label = meta && meta.label ? meta.label : 'Botón URL (' + (i + 1) + ')';
      parts.push(
        '<div class="campaign-param-row">' +
          '<label class="field">' +
          '<span class="field-label">' +
          esc(label) +
          '</span>' +
          '<input type="text" name="buttonParam_' +
          i +
          '" class="campaign-param-input" required maxlength="1024" autocomplete="off" data-static-placeholder="Dato fijo para todos los destinatarios" />' +
          '<span class="inline-help campaign-param-help">Escribe el dato fijo que se enviará igual para todos los destinatarios.</span>' +
          '</label>' +
          paramSourceSelectHtml('buttonParamSource_' + i) +
          '</div>'
      );
    }

    if (parts.length === 1) {
      parts.push('<p class="muted">Esta plantilla no requiere parámetros variables.</p>');
    }

    container.innerHTML = '<div class="form-grid tight">' + parts.join('') + '</div>';
    syncParamRows(container);
    container.hidden = false;
  }

  async function loadDefinition(id) {
    if (!select || !container) return;
    const requestId = ++templateLoadRequestId;
    templateDefinitionReady = false;
    if (!id) {
      container.innerHTML = '';
      container.hidden = true;
      updateSubmitEnabled();
      return;
    }
    container.innerHTML = '<p class="muted">Cargando…</p>';
    container.hidden = false;
    updateSubmitEnabled();
    try {
      const url = basePath + '/api/templates/' + encodeURIComponent(id) + '/definition';
      const r = await fetch(url, { credentials: 'same-origin' });
      const data = await r.json().catch(function () {
        return {};
      });
      if (requestId !== templateLoadRequestId) return;
      if (!data.ok || !data.definition) {
        const msg = data.error || 'No se pudo cargar la plantilla seleccionada.';
        container.innerHTML = '<p class="inline-warn">' + esc(msg) + '</p>';
        showCampaignToast(msg, 'err');
        updateSubmitEnabled();
        return;
      }
      buildFields(data.definition);
      templateDefinitionReady = true;
      updateSubmitEnabled();
    } catch (e) {
      if (requestId !== templateLoadRequestId) return;
      container.innerHTML = '<p class="inline-warn">Error al cargar la definición.</p>';
      showCampaignToast('Error de red al cargar la definición de la plantilla.', 'err');
      updateSubmitEnabled();
    }
  }

  if (select) {
    select.addEventListener('change', function () {
      loadDefinition(select.value);
    });
    if (select.value) {
      loadDefinition(select.value);
    }
  }

  if (container) {
    container.addEventListener('change', function (ev) {
      if (ev.target && ev.target.classList.contains('campaign-param-source')) {
        syncParamRows(container);
      }
    });
  }

  function renderRecipients(contacts) {
    if (!recipientsListEl) return;
    if (!contacts.length) {
      recipientsListEl.innerHTML =
        '<p class="campaign-recipients-empty">No hay contactos elegibles (opt-in y activos) en la unión de los segmentos elegidos.</p>';
      recipientsListEl.hidden = false;
      if (recipientsToolbar) recipientsToolbar.hidden = true;
      recipientsLoaded = false;
      updateRecipientCount();
      return;
    }
    const rows = contacts.map(function (c) {
      const id = Number(c.id);
      const name = c.name != null ? String(c.name) : '';
      const phone = c.phone != null ? String(c.phone) : '';
      return (
        '<label class="field field--row campaign-recipient-row">' +
        '<input type="checkbox" name="recipientContact" value="' +
        id +
        '" checked />' +
        '<span class="campaign-recipient-meta">' +
        '<span class="campaign-recipient-name">' +
        esc(name || '—') +
        '</span> ' +
        '<span class="mono campaign-recipient-phone">' +
        esc(phone) +
        '</span></span>' +
        '</label>'
      );
    });
    recipientsListEl.innerHTML = rows.join('');
    recipientsListEl.hidden = false;
    if (recipientsToolbar) recipientsToolbar.hidden = false;
    recipientsLoaded = true;
    updateRecipientCount();
  }

  async function loadRecipients() {
    if (!loadRecipientsBtn || !recipientsStatus) return;
    const segments = getCheckedSegments();
    if (segments.length === 0) {
      recipientsStatus.textContent = 'Marca al menos un segmento.';
      showCampaignToast('Marca al menos un segmento para cargar destinatarios.', 'warn');
      return;
    }
    recipientsStatus.textContent = 'Cargando…';
    loadRecipientsBtn.disabled = true;
    showSendError('');
    try {
      const previewBody = { segments: segments };
      const excludeSegs = getCheckedExcludeSegments();
      if (excludeSegs.length) previewBody.excludeSegmentSlugs = excludeSegs;

      const r = await fetch(basePath + '/api/campaigns/recipients-preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(previewBody),
      });
      const data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok || !data.ok) {
        const msg = data.error || 'No se pudo cargar la lista de destinatarios.';
        recipientsStatus.textContent = msg;
        showCampaignToast(msg, 'err');
        if (recipientsListEl) {
          recipientsListEl.innerHTML = '';
          recipientsListEl.hidden = true;
        }
        if (recipientsToolbar) recipientsToolbar.hidden = true;
        recipientsLoaded = false;
        updateSubmitEnabled();
        return;
      }
      recipientsStatus.textContent = data.total ? data.total + ' contacto(s).' : '';
      renderRecipients(data.contacts || []);
      if (!data.total) {
        showCampaignToast('No hay contactos elegibles para los segmentos seleccionados.', 'warn');
      }
    } catch (e) {
      const msg = 'Error de red al cargar destinatarios.';
      recipientsStatus.textContent = msg;
      showCampaignToast(msg, 'err');
      recipientsLoaded = false;
      updateSubmitEnabled();
    } finally {
      loadRecipientsBtn.disabled = false;
    }
  }

  if (loadRecipientsBtn) {
    loadRecipientsBtn.addEventListener('click', function () {
      loadRecipients();
    });
  }

  if (selectAllBtn && recipientsListEl) {
    selectAllBtn.addEventListener('click', function () {
      recipientsListEl.querySelectorAll('input[name="recipientContact"]').forEach(function (cb) {
        cb.checked = true;
      });
      updateRecipientCount();
    });
  }

  if (selectNoneBtn && recipientsListEl) {
    selectNoneBtn.addEventListener('click', function () {
      recipientsListEl.querySelectorAll('input[name="recipientContact"]').forEach(function (cb) {
        cb.checked = false;
      });
      updateRecipientCount();
    });
  }

  if (recipientsListEl) {
    recipientsListEl.addEventListener('change', function (ev) {
      if (ev.target && ev.target.name === 'recipientContact') updateRecipientCount();
    });
  }

  const scheduleRadios = form.querySelectorAll('input[name="scheduleMode"]');

  function setMinScheduleTime() {
    if (!scheduledAtInput) return;
    const d = new Date(Date.now() + 120000);
    const pad = function (n) {
      return String(n).padStart(2, '0');
    };
    scheduledAtInput.min =
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes());
  }

  function updateScheduleUi() {
    const checked = form.querySelector('input[name="scheduleMode"]:checked');
    const mode = checked ? checked.value : 'now';
    const isSched = mode === 'scheduled';
    if (scheduleWrap) scheduleWrap.hidden = !isSched;
    if (scheduledAtInput) {
      scheduledAtInput.required = isSched;
      if (isSched) setMinScheduleTime();
    }
    if (submitBtn && !submitBtn.hasAttribute('data-disabled-by-server')) {
      submitBtn.textContent = mode === 'scheduled' ? 'Programar campaña' : 'Enviar campaña';
    }
    updateSubmitEnabled();
  }

  scheduleRadios.forEach(function (r) {
    r.addEventListener('change', updateScheduleUi);
  });
  if (scheduledAtInput) {
    scheduledAtInput.addEventListener('change', updateSubmitEnabled);
    scheduledAtInput.addEventListener('input', updateSubmitEnabled);
  }
  updateScheduleUi();

  if (submitWrap) {
    submitWrap.addEventListener('click', function (ev) {
      if (!submitBtn || !submitBtn.disabled) return;
      const blockers = getSubmitBlockers();
      if (!blockers.length) return;
      ev.preventDefault();
      showSubmitBlockersToasts(blockers);
      scrollToFirstBlocker();
    });
  }

  form.addEventListener(
    'invalid',
    function (ev) {
      const el = ev.target;
      if (!el || !form.contains(el)) return;
      const label =
        (el.labels && el.labels[0] && el.labels[0].textContent && el.labels[0].textContent.trim()) ||
        el.getAttribute('aria-label') ||
        el.name ||
        'Campo obligatorio';
      showCampaignToast('Completa el campo: ' + label, 'warn');
    },
    true
  );

  function collectPayload() {
    const templateSyncId = parseInt(String(select ? select.value : '').trim(), 10);
    const batchSize = parseInt(String(form.querySelector('[name="batchSize"]') && form.querySelector('[name="batchSize"]').value || '40'), 10);
    const batchDelayMs = parseInt(String(form.querySelector('[name="batchDelayMs"]') && form.querySelector('[name="batchDelayMs"]').value || '1500'), 10);
    const scheduleMode = form.querySelector('input[name="scheduleMode"]:checked');
    const mode = scheduleMode ? scheduleMode.value : 'now';

    const excludeSegs = getCheckedExcludeSegments();

    const payload = {
      templateSyncId: templateSyncId,
      batchSize: batchSize,
      batchDelayMs: batchDelayMs,
      scheduleMode: mode,
      segments: getCheckedSegments(),
      recipientContactIds: getCheckedRecipientIds(),
      excludeSegmentSlugs: excludeSegs,
    };

    if (container) {
      container.querySelectorAll('input, textarea, select').forEach(function (el) {
        if (!el.name) return;
        payload[el.name] = el.value;
      });
    }

    if (mode === 'scheduled' && scheduledAtInput) {
      const localVal = String(scheduledAtInput.value || '').trim();
      if (localVal) {
        const d = new Date(localVal);
        if (!Number.isNaN(d.getTime())) {
          payload.scheduledAt = d.toISOString();
        }
      }
    }

    return payload;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    showSendError('');

    const blockers = getSubmitBlockers();
    if (blockers.length) {
      showSubmitBlockersToasts(blockers);
      scrollToFirstBlocker();
      return;
    }

    if (!form.checkValidity()) {
      showCampaignToast('Completa los campos obligatorios de la plantilla o la programación.', 'warn');
      form.reportValidity();
      return;
    }

    const payload = collectPayload();

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando…';
    }

    fetch(basePath + '/campaigns/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        const ct = r.headers.get('content-type') || '';
        if (r.ok && ct.indexOf('application/json') !== -1) {
          return r.json().then(function (data) {
            if (data.redirect) {
              window.location.href = data.redirect;
              return;
            }
            showSendError('Respuesta inesperada del servidor.');
          });
        }
        if (r.status === 400 || r.status === 500) {
          return r.json()
            .then(function (j) {
              showSendError(j.error || j.message || 'No se pudo enviar.', r.status);
            })
            .catch(function () {
              return r.text().then(function (t) {
                showSendError(t || 'Error al enviar.', r.status);
              });
            });
        }
        return r.text().then(function (t) {
          showSendError(t || 'Error al enviar.', r.status);
        });
      })
      .catch(function () {
        showSendError('Error de red al contactar con el servidor.', 0);
      })
      .finally(function () {
        updateScheduleUi();
        updateSubmitEnabled();
      });
  });

  function invalidateRecipientsPreview() {
    const hadRecipients = recipientsLoaded;
    recipientsLoaded = false;
    if (recipientsListEl) {
      recipientsListEl.innerHTML = '';
      recipientsListEl.hidden = true;
    }
    if (recipientsToolbar) recipientsToolbar.hidden = true;
    if (recipientsStatus) {
      recipientsStatus.textContent = hadRecipients ? 'Vuelve a mostrar destinatarios.' : '';
    }
    if (hadRecipients) {
      showCampaignToast('Cambiaste los segmentos. Vuelve a mostrar destinatarios antes de enviar.', 'warn');
    }
    updateSubmitEnabled();
  }

  form.querySelectorAll('input[name="campaignSegment"]').forEach(function (el) {
    el.addEventListener('change', invalidateRecipientsPreview);
  });

  form.querySelectorAll('input[name="campaignExcludeSegment"]').forEach(function (el) {
    el.addEventListener('change', invalidateRecipientsPreview);
  });

  fetch((basePath || '') + '/api/attribute-definitions/options', { credentials: 'same-origin' })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (data && data.ok && Array.isArray(data.options)) {
        paramSourceOptions = data.options;
        refreshParamSourceSelects();
        return;
      }
      showCampaignToast('No se pudieron cargar los atributos de contacto. Puedes usar valores fijos, nombre o teléfono.', 'warn');
    })
    .catch(function () {
      showCampaignToast('No se pudieron cargar los atributos de contacto. Puedes usar valores fijos, nombre o teléfono.', 'warn');
    });

})();
