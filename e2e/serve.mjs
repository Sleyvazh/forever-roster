/**
 * Sert le front construit (apps/web/dist) comme Caddy en production :
 * mêmes en-têtes de sécurité (lus dans infra/Caddyfile, source unique), repli SPA sur index.html,
 * et /api relayé vers l'API. Permet de tester la vraie CSP sans Docker.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "apps/web/dist");
const PORT = Number(process.env.E2E_PORT ?? 4173);
const API = process.env.E2E_API ?? "http://127.0.0.1:3000";

// En-têtes du bloc « header { … } » du Caddyfile
const caddy = readFileSync(path.join(root, "infra/Caddyfile"), "utf8");
const block = caddy.match(/header \{([\s\S]*?)\n\t\}/)?.[1] ?? "";
const headers = Object.fromEntries([...block.matchAll(/^\s*([A-Za-z-]+)\s+"([^"]*)"/gm)].map(m => [m[1], m[2]]));
if (!headers["Content-Security-Policy"]) throw new Error("CSP introuvable dans infra/Caddyfile");
delete headers["Strict-Transport-Security"]; // HTTP en local

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon", ".webp": "image/webp" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const up = http.request(API + req.url, { method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
    return;
  }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  // Accueil public (comme Caddy) : page statique propre à chaque adresse (RETAIL_ORIGIN : Roster, sinon Forever Roster)
  const retailHost = process.env.RETAIL_ORIGIN ? new URL(process.env.RETAIL_ORIGIN).host : null;
  if (url.pathname === "/") url.pathname = `/landing/${req.headers.host === retailHost ? "retail" : "forever"}.html`;
  let file = path.join(dist, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ""));
  if (!file.startsWith(dist)) { res.writeHead(400); res.end(); return; }
  if (url.pathname.startsWith("/icons/") && !existsSync(file)) { res.writeHead(404); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Front de test : http://localhost:${PORT}`));
