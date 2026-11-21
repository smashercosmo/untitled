import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [
    // Share local D1/R2 state with workers/sync (`wrangler dev --persist-to .wrangler/state`).
    voidPlugin({ persistTo: "../../workers/sync/.wrangler/state" }),
    react(),
  ],
});
