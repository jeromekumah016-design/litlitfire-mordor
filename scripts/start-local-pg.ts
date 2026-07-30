/**
 * Start embedded Postgres for local dev on port 55432 / db litlit_dev.
 * Leaves the process running until killed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PG_DIR = path.join(root, ".pg-data-dev");
const PORT = 55432;

const pg = new EmbeddedPostgres({
  databaseDir: PG_DIR,
  user: "postgres",
  password: "password",
  port: PORT,
  persistent: true,
});

async function main() {
  const fresh = !fs.existsSync(path.join(PG_DIR, "PG_VERSION"));
  if (fresh) {
    console.log("[local-pg] Initialising cluster at", PG_DIR);
    await pg.initialise();
  }
  console.log("[local-pg] Starting on port", PORT);
  await pg.start();
  try {
    await pg.createDatabase("litlit_dev");
    console.log("[local-pg] Database litlit_dev ready");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists/i.test(msg)) console.warn("[local-pg] createDatabase:", msg);
    else console.log("[local-pg] Database litlit_dev already exists");
  }
  console.log(`[local-pg] DATABASE_URL=postgresql://postgres:password@127.0.0.1:${PORT}/litlit_dev`);
  console.log("[local-pg] Running — Ctrl+C to stop");
  // Keep alive
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
