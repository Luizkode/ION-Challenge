// Produces a reviewable SQL package; no database connection or remote mutation.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = new URL("../", import.meta.url);
const migration = await readFile(
  new URL("supabase/migrations/005_clients_services.sql", root),
  "utf8",
);
const matching = await readFile(
  new URL("supabase/migrations/006_operational_conversion_matching.sql", root),
  "utf8",
);
const checks = await readFile(
  new URL("supabase/checks/stage_4_security.sql", root),
  "utf8",
);
if (!migration.trimEnd().endsWith("COMMIT;"))
  throw new Error("Unexpected transaction boundaries");
const guard = `DO $$ BEGIN IF to_regclass('public.crm_leads') IS NULL OR to_regclass('public.ops_clients') IS NOT NULL THEN RAISE EXCEPTION 'Requires exact schema 004';END IF;END $$;`;
const sql = migration
  .replace("BEGIN;", "BEGIN;\n" + guard)
  .replace(
    /COMMIT;\s*$/,
    matching.replace("BEGIN;", "").replace(/COMMIT;\s*$/, "") +
      "\n" +
      checks +
      "\nCOMMIT;\n",
  );
const output = resolve(
  process.argv.find((v) => v.startsWith("--output="))?.slice(9) ??
    "/tmp/ion-os-operations-release",
);
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(resolve(output, "operations-release.sql"), sql, {
  mode: 0o600,
});
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(
    {
      from: "004",
      migrations: [
        "005_clients_services.sql",
        "006_operational_conversion_matching.sql",
      ],
      sha256: createHash("sha256").update(sql).digest("hex"),
      remote_execution: false,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  "Operations SQL package prepared. No remote execution. Requires verified recovery.",
);
