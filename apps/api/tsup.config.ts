import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", "migrate-cli": "src/db/migrate-cli.ts", "import-gamedata": "src/gamedata/import-cli.ts", "blp-icons": "src/gamedata/blp-cli.ts", "role-icons": "src/gamedata/role-icons-cli.ts", "roster-preview": "src/db/roster-preview-cli.ts", "site-admin": "src/db/site-admin-cli.ts" },
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Le paquet de données de jeu est en TypeScript : on l'embarque dans le bundle.
  noExternal: ["@forever/game-data"],
});
