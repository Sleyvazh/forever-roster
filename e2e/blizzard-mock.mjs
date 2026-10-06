/**
 * Battle.net simulé pour les tests de bout en bout (port 4199) : page d'accord qui renvoie tout de suite au site,
 * jetons, liste des persos du compte et profils publics. Aucun appel à Blizzard pendant les tests.
 */
import http from "node:http";

const PORT = Number(process.env.BNET_MOCK_PORT ?? 4199);
const ACCOUNT = [
  { id: 1001, name: "Brumelune", level: 90, realm: { name: "Hyjal", slug: "hyjal" }, playable_class: { id: 10 }, faction: { type: "ALLIANCE" } },
  { id: 1002, name: "Vaelis", level: 90, realm: { name: "Kael'Thas", slug: "kaelthas" }, playable_class: { id: 2 }, faction: { type: "HORDE" } },
  { id: 1003, name: "Petit", level: 23, realm: { name: "Hyjal", slug: "hyjal" }, playable_class: { id: 8 }, faction: { type: "ALLIANCE" } },
];
const PROFILES = {
  "hyjal/brumelune": { id: 1001, level: 90, character_class: { id: 10 }, active_spec: { name: "Mistweaver" }, equipped_item_level: 712.4 },
  "kaelthas/vaelis": { id: 1002, level: 90, character_class: { id: 2 }, active_spec: { name: "Protection" }, equipped_item_level: 708 },
  "hyjal/petit": { id: 1003, level: 23, character_class: { id: 8 }, active_spec: { name: "Frost" }, equipped_item_level: 41 },
};

const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.search = new URLSearchParams({ code: "e2e-code", state: url.searchParams.get("state") ?? "" }).toString();
    res.writeHead(302, { Location: back.toString() }); return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", d => { body += d; });
    req.on("end", () => json(res, 200, new URLSearchParams(body).get("grant_type") === "client_credentials"
      ? { access_token: "app-token", expires_in: 86400 } : { access_token: "user-token" }));
    return;
  }
  if (url.pathname === "/userinfo") return json(res, 200, { id: 4242, battletag: "Testeur#1234" });
  if (url.pathname === "/profile/user/wow") return json(res, 200, { wow_accounts: [{ characters: ACCOUNT }] });
  const m = url.pathname.match(/^\/profile\/wow\/character\/([^/]+)\/([^/]+)$/);
  if (m && PROFILES[`${m[1]}/${decodeURIComponent(m[2])}`]) return json(res, 200, PROFILES[`${m[1]}/${decodeURIComponent(m[2])}`]);
  json(res, 404, { code: 404 });
}).listen(PORT, "127.0.0.1");
