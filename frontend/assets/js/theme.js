(function () {
  var theme = "light";
  try {
    var saved = localStorage.getItem("sk_theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#090909" : "#ffffff");
})();
