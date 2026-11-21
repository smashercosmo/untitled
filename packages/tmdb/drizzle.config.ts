import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for the tmdb_* tables. They are applied with
// `wrangler d1 migrations apply` (migrations_table: tmdb_migrations), never by Void.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
