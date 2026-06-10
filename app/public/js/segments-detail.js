(function () {
  const card = document.querySelector('.segment-members-card');
  if (!card) return;

  const BLOCKED_MSG =
    'El contacto debe conservar al menos un segmento. Asígnale otro segmento antes de quitar este vínculo.';

  function ensureToastHost() {
    let host = document.getElementById('segment-toast-stack');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'segment-toast-stack';
    host.className = 'campaign-toast-stack';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    card.insertBefore(host, card.firstChild);
    return host;
  }

  function showSegmentToast(message, type) {
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

  card.querySelectorAll('.segment-remove-wrap.is-blocked').forEach(function (wrap) {
    const btn = wrap.querySelector('.segment-remove-btn');
    if (!btn) return;

    wrap.addEventListener('click', function (ev) {
      if (!btn.disabled) return;
      ev.preventDefault();
      const msg = wrap.getAttribute('data-blocked-msg') || BLOCKED_MSG;
      showSegmentToast(msg, 'warn');
    });
  });
})();
