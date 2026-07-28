import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  // Vite defaults this to <root>/node_modules/.vite. node_modules is
  // sometimes a symlink to a build dir owned by a different sandbox user
  // than the one running the suite (seen repeatedly in this repo's overnight
  // sessions), which makes the default cache dir unwritable and vitest exits
  // non-zero on the results-cache write alone even when every test passed.
  // Keeping the cache inside the checkout itself sidesteps that.
  cacheDir: path.resolve(templateRoot, ".vite-cache"),
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "shared/**/*.test.ts", "shared/**/*.spec.ts"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
