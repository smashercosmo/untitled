import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "../../packages/tmdb/migrations")),
          // Override .dev.vars: tests must never hit real Telegram or TMDB.
          TELEGRAM_BOT_TOKEN: "",
          TELEGRAM_CHAT_ID: "",
          TMDB_READ_ACCESS_TOKEN: "test.header.token",
          TMDB_TOKEN: "",
          TMDB_RPS: "1000",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
