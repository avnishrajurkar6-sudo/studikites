/* StudiKitEZ frontend bootstrap — NO secrets here.
   Backend URL comes from <meta name="sk-backend"> (or window override).
   The catalog is fetched from /api/courses/batches, with batches.json fallback. */
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
  window.__SK__.brand = "AVkings";

  /* Keep the early theme choice in place; theme.js sets it before styles load. */
  try {
    var savedTheme = localStorage.getItem("sk_theme");
    if (savedTheme === "dark" || savedTheme === "light") document.documentElement.setAttribute("data-theme", savedTheme);
  } catch (e) {}

  /* AVkings favicon — inline SVG so it works offline and on every page. */
  if (!document.querySelector('link[rel="icon"]')) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="14" fill="#111827"/>' +
      '<path d="M14 18h9l9 22 9-22h9L38 50h-12L14 18z" fill="#fff"/></svg>';
    var link = document.createElement("link");
    link.rel = "icon";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
    document.head.appendChild(link);
  }
})();
