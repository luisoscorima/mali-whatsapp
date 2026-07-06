(function () {
  document.addEventListener('click', function (ev) {
    document.querySelectorAll('.wa-rail__more[open]').forEach(function (d) {
      if (d.contains(ev.target)) return;
      d.removeAttribute('open');
    });
  });
})();
