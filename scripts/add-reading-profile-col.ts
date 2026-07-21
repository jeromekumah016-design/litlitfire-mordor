import { Client } from "pg";

async function main() {
  const url =
    process.env.DATABASE_URL ||
    "postgresql://postgres:password@127.0.0.1:55432/litlit_dev";
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(
    `ALTER TABLE books ADD COLUMN IF NOT EXISTS "readingProfile" jsonb`
  );
  console.log("readingProfile column ensured");
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
