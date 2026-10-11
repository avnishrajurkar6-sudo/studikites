/* StudiKitEZ frontend bootstrap — NO secrets here.
   Set the backend URL once via <meta name="sk-backend" content="https://...">
   (same-origin "" default). Public Firebase config is fetched from the backend. */
(function () {
  window.__SK__ = window.__SK__ || {};
  var meta = document.querySelector('meta[name="sk-backend"]');
  var override = "";
  try {
    override = window.__SK_BACKEND_BASE_URL__ || (meta && meta.getAttribute("content")) || localStorage.getItem("sk_backend") || "";
  } catch (e) { override = ""; }
  window.__SK__.backendBaseUrl = String(override || "").replace(/\/+$/, "");
  window.__SK__.batchesUrl = "batches.json";
  window.__SK__.telegramUrl = "https://t.me/Studikitesbot";
})();
