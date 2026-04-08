(function () {
  const KEY = 'mali-theme';
  function apply(t) {
    const theme = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (_) {}
  }
  function init() {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'dark' || stored === 'light') {
        apply(stored);
      }
    } catch (_) {}
  }
  init();
  document.querySelectorAll('[data-theme-toggle]').forEach(function (el) {
    el.addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      apply(cur === 'dark' ? 'light' : 'dark');
    });
  });
})();
