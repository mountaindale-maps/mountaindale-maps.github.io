(function () {
  var KEY = 'md_public_show_labels', btn = document.getElementById('labelsToggle');
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (_) {}
  var on = stored === '1'; // default OFF; an explicit saved '1' (On) still wins
  function apply() {
    document.body.classList.toggle('labels-off', !on);
    btn.textContent = on ? 'Labels: On' : 'Labels: Off';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  apply();
  btn.addEventListener('click', function () { on = !on; apply(); try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {} });
  function fitUI() {
    document.documentElement.style.setProperty('--app-height', innerHeight + 'px');
    document.documentElement.style.setProperty('--toolbar-bottom', document.getElementById('top').getBoundingClientRect().bottom + 'px');
  }
  fitUI(); addEventListener('resize', fitUI);
  if (window.ResizeObserver) new ResizeObserver(fitUI).observe(document.getElementById('top'));
  if (window.visualViewport) visualViewport.addEventListener('resize', fitUI);
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, {passive: false});
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); }, {passive: false});
  document.addEventListener('touchmove', function (e) { if (!e.target.closest('.panel')) e.preventDefault(); }, {passive: false});
  // Keep only one information sheet open; do not let it obscure the Layers list.
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  var handling = false;
  new MutationObserver(function (changes) {
    if (handling) return;
    var opened = changes.filter(function (m) { return m.target.classList.contains('show') && (m.oldValue || '').indexOf('show') < 0; });
    if (!opened.length) return;
    var active = opened[opened.length - 1].target; handling = true;
    panels.forEach(function (p) { if (p !== active) p.classList.remove('show'); }); handling = false;
    var heading = active.querySelector('h2'); if (heading) { heading.tabIndex = -1; heading.focus({preventScroll: true}); }
  }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true});
  addEventListener('keydown', function (e) { if (e.key === 'Escape') panels.forEach(function (p) { p.classList.remove('show'); }); });
})();
