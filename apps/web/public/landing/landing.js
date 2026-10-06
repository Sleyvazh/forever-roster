// Pages d'accueil publiques : thème choisi sur le site (s'il y en a un), et accès direct pour qui est déjà connecté.
(function () {
  try {
    var t = localStorage.getItem("fr-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* stockage indisponible : thème du système */ }
  fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) { if (me && me.user) location.replace("/persos"); })
    .catch(function () { /* pas de réponse : la page reste affichée */ });
})();
