import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/db/migrate-cli.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Le paquet de données de jeu est en TypeScript : on l'embarque dans le bundle.
  noExternal: ["@forever/game-data"],
});
