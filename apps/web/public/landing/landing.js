// Pages d'accueil publiques : thème choisi sur le site (s'il y en a un), et accès direct pour qui est déjà connecté.
(function () {
  // Page d'arrivée de qui est déjà connecté : l'Accueil de sa guilde (Forever Roster), Mes persos (Roster)
  var script = document.currentScript;
  var home = (script && script.getAttribute("data-home")) || "/persos";
  // Bandeau daté (data-launch, data-after) : son texte change tout seul une fois la date passée
  var pills = document.querySelectorAll("[data-launch][data-after]");
  for (var i = 0; i < pills.length; i++) {
    if (Date.now() >= Date.parse(pills[i].getAttribute("data-launch"))) pills[i].textContent = pills[i].getAttribute("data-after");
  }
  // Langue (version anglaise, 10/11/2026) : « English » / « Français » et /?lang=en gardent le choix dans le cookie fr-lang,
  // lu par le serveur (cette page) et par le site (même langue après la connexion)
  function keepLang(l) {
    try { document.cookie = "fr-lang=" + l + "; Path=/; Max-Age=31536000; SameSite=Lax; Secure"; } catch (e) { /* cookies refusés */ }
  }
  var asked = /[?&]lang=(fr|en)(?:&|$)/.exec(location.search);
  if (asked) keepLang(asked[1]);
  var langs = document.querySelectorAll("a[data-lang]");
  for (var j = 0; j < langs.length; j++) {
    langs[j].addEventListener("click", function () { keepLang(this.getAttribute("data-lang")); });
  }
  try {
    var t = localStorage.getItem("fr-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* stockage indisponible : thème du système */ }
  fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) { if (me && me.user) location.replace(home); })
    .catch(function () { /* pas de réponse : la page reste affichée */ });
})();
