import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const localStatePath = process.env.RETASTE_PILOT_STATE_DIR ??
  (process.env.RETASTE_E2E === "true" ? ".wrangler/e2e-state" : undefined);

export default defineConfig({
  plugins: [
    cloudflare({
      remoteBindings: false,
      viteEnvironment: { name: "ssr" },
      persistState: localStatePath ? { path: localStatePath } : true,
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // Feature worktrees share the repository dependency store. Keep the allow
    // list bounded to this checkout and its owning repository.
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
