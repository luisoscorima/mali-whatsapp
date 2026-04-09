(function () {
  document.querySelectorAll('[data-inbox-filter]').forEach(function (el) {
    el.addEventListener('change', function () {
      if (el.form) el.form.submit();
    });
  });
})();
