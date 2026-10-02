/**
 * Static clone mock interaction client - Artupski ReSite
 * Source of truth: docs/specs/CLONE-SPEC.md section 5.
 *
 * The emitted `js/mock-client.js` makes a static clone *feel* interactive
 * without a backend: form submissions are intercepted and shown as local
 * feedback (never sent anywhere), and simple tab controls are toggled. It is a
 * self-contained string constant so the clone writer has no runtime dependency
 * on the app bundle.
 */
export const MOCK_CLIENT_JS = `(function () {
  console.log('[Artupski Static Clone] Mock Interaction Client Active.');

  // Intercept form submissions - nothing is sent to a server.
  document.addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target;
    if (!form) { return; }
    var data = {};
    try {
      var formData = new FormData(form);
      formData.forEach(function (value, key) { data[key] = value; });
    } catch (error) { /* ignore */ }
    console.log('[Artupski Mock] Intercepted form submission:', data);

    var toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:999999;' +
      'background:#0f172a;color:#38bdf8;padding:12px 20px;border-radius:8px;' +
      'border:1px solid #0284c7;font-family:monospace;font-size:13px;' +
      'box-shadow:0 10px 15px -3px rgba(0,0,0,0.3);';
    toast.textContent = 'Static Clone: form submit captured locally (see browser console).';
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4000);
  });

  // Mock dynamic tab switches for [data-toggle="tab"] / [role="tab"].
  document.querySelectorAll('[data-toggle="tab"], [role="tab"]').forEach(function (tab) {
    tab.addEventListener('click', function (event) {
      var targetId = tab.getAttribute('aria-controls') || tab.getAttribute('href');
      if (targetId && targetId.charAt(0) === '#') {
        event.preventDefault();
        var pane = document.querySelector(targetId);
        if (pane && pane.parentElement) {
          Array.prototype.forEach.call(pane.parentElement.children, function (child) {
            child.style.display = 'none';
          });
          pane.style.display = 'block';
        }
      }
    });
  });
})();
`;
