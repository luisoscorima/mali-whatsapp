(function () {
  document.querySelectorAll('[data-inbox-filter]').forEach(function (el) {
    el.addEventListener('change', function () {
      if (el.form) el.form.submit();
    });
  });

  var fileInput = document.querySelector('.reply-form-file-input');
  var previewWrap = document.getElementById('reply-attachment-preview');
  var previewBody = document.getElementById('reply-attachment-preview-body');
  var clearBtn = document.getElementById('reply-attachment-clear');
  var linkWrap = document.getElementById('reply-link-preview');
  var linkBody = document.getElementById('reply-link-preview-body');
  var textarea = document.querySelector('.inbox-reply-form textarea[name="message"]');

  var currentObjectUrl = null;

  function revokePreviewUrl() {
    if (currentObjectUrl) {
      try {
        URL.revokeObjectURL(currentObjectUrl);
      } catch (e) {}
      currentObjectUrl = null;
    }
  }

  function clearFilePreview() {
    revokePreviewUrl();
    if (previewBody) previewBody.innerHTML = '';
    if (previewWrap) previewWrap.hidden = true;
    if (fileInput) fileInput.value = '';
  }

  function firstHttpUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s<>"'()[\]]+/i);
    return m ? m[0].replace(/[.,;:!?)]+$/, '') : null;
  }

  function isSafeHttpUrl(s) {
    try {
      var u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function looksLikeImageUrl(url) {
    return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url);
  }

  function updateLinkPreview() {
    if (!linkWrap || !linkBody || !textarea) return;
    var raw = firstHttpUrl(textarea.value);
    if (!raw || !isSafeHttpUrl(raw)) {
      linkWrap.hidden = true;
      linkBody.replaceChildren();
      return;
    }
    linkWrap.hidden = false;
    linkBody.replaceChildren();
    var p = document.createElement('p');
    p.className = 'reply-attachment-preview__filename';
    var a = document.createElement('a');
    a.href = raw;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = raw;
    p.appendChild(a);
    linkBody.appendChild(p);
    if (looksLikeImageUrl(raw)) {
      var wrap = document.createElement('div');
      wrap.className = 'reply-link-preview__img-wrap';
      var img = document.createElement('img');
      img.src = raw;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () {
        wrap.style.display = 'none';
      };
      wrap.appendChild(img);
      linkBody.appendChild(wrap);
    }
  }

  function renderFilePreview(file) {
    if (!previewWrap || !previewBody) return;
    revokePreviewUrl();
    previewBody.innerHTML = '';
    var type = (file.type || '').split(';')[0].trim();
    var name = file.name || 'archivo';

    if (type === 'image/jpeg' || type === 'image/png') {
      currentObjectUrl = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.src = currentObjectUrl;
      img.alt = 'Vista previa: ' + name;
      previewBody.appendChild(img);
      previewWrap.hidden = false;
      return;
    }

    if (type === 'application/pdf') {
      currentObjectUrl = URL.createObjectURL(file);
      var frame = document.createElement('iframe');
      frame.title = 'Vista previa PDF';
      frame.src = currentObjectUrl;
      previewBody.appendChild(frame);
      previewWrap.hidden = false;
      return;
    }

    if (type === 'video/mp4') {
      currentObjectUrl = URL.createObjectURL(file);
      var vid = document.createElement('video');
      vid.src = currentObjectUrl;
      vid.controls = true;
      vid.playsInline = true;
      previewBody.appendChild(vid);
      previewWrap.hidden = false;
      return;
    }

    if (
      type.indexOf('audio/') === 0 ||
      type === 'application/ogg' ||
      type === 'audio/mpeg' ||
      type === 'audio/mp3'
    ) {
      currentObjectUrl = URL.createObjectURL(file);
      var aud = document.createElement('audio');
      aud.src = currentObjectUrl;
      aud.controls = true;
      previewBody.appendChild(aud);
      var cap = document.createElement('p');
      cap.className = 'reply-attachment-preview__filename';
      cap.textContent = name;
      previewBody.appendChild(cap);
      previewWrap.hidden = false;
      return;
    }

    var p = document.createElement('p');
    p.className = 'reply-attachment-preview__filename';
    p.textContent = name + ' (' + (type || 'tipo desconocido') + ') — sin vista previa.';
    previewBody.appendChild(p);
    previewWrap.hidden = false;
  }

  if (fileInput && previewWrap && previewBody) {
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) {
        clearFilePreview();
        return;
      }
      renderFilePreview(f);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      clearFilePreview();
    });
  }

  if (textarea) {
    textarea.addEventListener('input', updateLinkPreview);
    textarea.addEventListener('change', updateLinkPreview);
    updateLinkPreview();
  }

  var body = document.body;
  var basePath = body && body.getAttribute('data-base-path');
  if (basePath === null) basePath = '';
  var emojiToggle = document.getElementById('inbox-emoji-toggle');
  var emojiPopover = document.getElementById('inbox-emoji-popover');
  var replyTa = document.querySelector('.inbox-reply-form textarea[name="message"]');
  if (emojiToggle && emojiPopover && replyTa) {
    var pickerUrl = basePath + '/vendor/emoji-picker-element/picker.js';
    import(pickerUrl)
      .then(function () {
        var picker = document.createElement('emoji-picker');
        picker.setAttribute('locale', 'es');
        if (document.documentElement.getAttribute('data-theme') === 'dark') {
          picker.classList.add('dark');
        }
        emojiPopover.appendChild(picker);
        picker.addEventListener('emoji-click', function (ev) {
          var unicode = ev.detail && ev.detail.unicode ? ev.detail.unicode : '';
          if (!unicode) return;
          var start = replyTa.selectionStart;
          var end = replyTa.selectionEnd;
          var v = replyTa.value;
          replyTa.value = v.slice(0, start) + unicode + v.slice(end);
          var pos = start + unicode.length;
          replyTa.selectionStart = replyTa.selectionEnd = pos;
          replyTa.focus();
          replyTa.dispatchEvent(new Event('input', { bubbles: true }));
          emojiPopover.hidden = true;
        });
        emojiToggle.addEventListener('click', function (ev) {
          ev.stopPropagation();
          emojiPopover.hidden = !emojiPopover.hidden;
        });
        document.addEventListener('click', function (ev) {
          if (emojiPopover.hidden) return;
          if (emojiPopover.contains(ev.target) || emojiToggle.contains(ev.target)) return;
          emojiPopover.hidden = true;
        });
      })
      .catch(function () {});
  }
})();
