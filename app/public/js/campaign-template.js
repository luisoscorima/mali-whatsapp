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
  const sendErrorEl = document.getElementById('campaign-send-error');

  let recipientsLoaded = false;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
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

  function paramSourceSelectHtml(name) {
    const opts = paramSourceOptions.map(function (o) {
      return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
    });
    return (
      '<label class="field field--compact">' +
      '<span class="field-label">Por contacto</span>' +
      '<select name="' +
      esc(name) +
      '" class="campaign-param-source">' +
      opts.join('') +
      '</select></label>'
    );
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

  function showSendError(msg) {
    if (!sendErrorEl) return;
    if (msg) {
      sendErrorEl.textContent = msg;
      sendErrorEl.hidden = false;
    } else {
      sendErrorEl.textContent = '';
      sendErrorEl.hidden = true;
    }
  }

  function updateRecipientCount() {
    if (!recipientsCountEl || !recipientsListEl) return;
    const total = recipientsListEl.querySelectorAll('input[name="recipientContact"]').length;
    const checked = getCheckedRecipientIds().length;
    recipientsCountEl.textContent = total ? checked + ' / ' + total + ' seleccionados' : '';
    updateSubmitEnabled();
  }

  function updateSubmitEnabled() {
    if (!submitBtn) return;
    if (submitBtn.hasAttribute('data-disabled-by-server')) return;
    const hasTemplate = select && select.value;
    const hasRecipients = recipientsLoaded && getCheckedRecipientIds().length > 0;
    submitBtn.disabled = !hasTemplate || !hasRecipients;
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
        '<div class="campaign-param-row">' +
          '<label class="field">' +
          '<span class="field-label">Texto cabecera (' +
          (i + 1) +
          ')</span>' +
          '<input type="text" name="headerParam_' +
          i +
          '" required maxlength="1024" autocomplete="off" />' +
          '</label>' +
          paramSourceSelectHtml('headerParamSource_' + i) +
          '</div>'
      );
    }

    for (let i = 0; i < def.bodySlotCount; i++) {
      parts.push(
        '<div class="campaign-param-row">' +
          '<label class="field">' +
          '<span class="field-label">Texto cuerpo (' +
          (i + 1) +
          ')</span>' +
          '<input type="text" name="bodyParam_' +
          i +
          '" required maxlength="1024" autocomplete="off" />' +
          '</label>' +
          paramSourceSelectHtml('bodyParamSource_' + i) +
          '</div>'
      );
    }

    for (let i = 0; i < def.totalButtonParams; i++) {
      parts.push(
        '<div class="campaign-param-row">' +
          '<label class="field">' +
          '<span class="field-label">Botón URL (' +
          (i + 1) +
          ')</span>' +
          '<input type="text" name="buttonParam_' +
          i +
          '" required maxlength="1024" autocomplete="off" />' +
          '</label>' +
          paramSourceSelectHtml('buttonParamSource_' + i) +
          '</div>'
      );
    }

    if (parts.length === 1) {
      parts.push('<p class="muted">Esta plantilla no requiere parámetros variables.</p>');
    }

    container.innerHTML = '<div class="form-grid tight">' + parts.join('') + '</div>';
    container.hidden = false;
  }

  async function loadDefinition(id) {
    if (!select || !container) return;
    if (!id) {
      container.innerHTML = '';
      container.hidden = true;
      updateSubmitEnabled();
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
      updateSubmitEnabled();
    } catch (e) {
      container.innerHTML = '<p class="inline-warn">Error al cargar la definición.</p>';
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
        recipientsStatus.textContent = data.error || 'No se pudo cargar la lista.';
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
    } catch (e) {
      recipientsStatus.textContent = 'Error de red al cargar destinatarios.';
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
  const scheduleWrap = document.getElementById('campaign-schedule-datetime-wrap');
  const scheduledAtInput = document.getElementById('campaign-scheduled-at');

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
  updateScheduleUi();

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
      container.querySelectorAll('input, textarea').forEach(function (el) {
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

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const ids = getCheckedRecipientIds();
    if (ids.length === 0) {
      showSendError('Selecciona al menos un destinatario.');
      return;
    }

    const segs = getCheckedSegments();
    if (segs.length === 0) {
      showSendError('Selecciona al menos un segmento.');
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
          return r.json().then(function (j) {
            showSendError(j.error || 'No se pudo enviar.');
          }).catch(function () {
            return r.text().then(function (t) {
              showSendError(t || 'Error al enviar.');
            });
          });
        }
        return r.text().then(function (t) {
          showSendError(t || 'Error al enviar.');
        });
      })
      .catch(function () {
        showSendError('Error de red.');
      })
      .finally(function () {
        updateScheduleUi();
        updateSubmitEnabled();
      });
  });

  function invalidateRecipientsPreview() {
    recipientsLoaded = false;
    if (recipientsListEl) {
      recipientsListEl.innerHTML = '';
      recipientsListEl.hidden = true;
    }
    if (recipientsToolbar) recipientsToolbar.hidden = true;
    if (recipientsStatus) recipientsStatus.textContent = '';
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
      }
    })
    .catch(function () {});

})();
