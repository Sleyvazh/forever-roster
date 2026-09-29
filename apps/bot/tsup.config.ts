import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bot: "src/main.ts" },
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: ["@forever/game-data"],
});
