import { defineConfig } from "void/config";

export default defineConfig({
  routing: { typedRoutes: true },
  worker: { compatibility_date: "2026-11-11" },
  auth: { providers: ["email"] },
  cloudflare: {
    name: "movies-web",
    d1_databases: [
      {
        // ONE shared database with workers/sync (Q13). Void owns only its own tables (auth + app);
        // the tmdb_* tables and their migrations belong to packages/tmdb (Q26).
        binding: "DB",
        database_name: "movies",
        // Cloud D1 (weur). Same id + same persist dir as workers/sync ⇒ the same local SQLite file in dev.
        // Don't add preview_database_id: the Void CLI would honour it but the Vite dev server ignores it,
        // and the two would then open different local databases.
        database_id: "f35b7e71-fda6-4a4c-9b3a-52dc23d72ed1",
        migrations_dir: "db/migrations",
        migrations_table: "_void_migrations",
      },
    ],
  },
});
