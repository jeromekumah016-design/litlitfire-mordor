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
  await c.query(`
    DO $$ BEGIN
      CREATE TYPE "public"."package_tier" AS ENUM('lite', 'upgraded');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
  await c.query(`
    ALTER TABLE books ADD COLUMN IF NOT EXISTS "packageTier" "package_tier" DEFAULT 'lite' NOT NULL
  `);
  console.log("readingProfile + packageTier columns ensured");
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
