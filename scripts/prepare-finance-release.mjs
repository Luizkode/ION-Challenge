// Local package only. Applying it requires a separately verified, current recovery copy.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = new URL("../", import.meta.url);
let sql = await readFile(
  new URL("supabase/migrations/007_finance.sql", root),
  "utf8",
);
const checks = await readFile(
  new URL("supabase/checks/stage_5_security.sql", root),
  "utf8",
);
const mrr = (
  await readFile(
    new URL("supabase/migrations/008_finance_historical_mrr.sql", root),
    "utf8",
  )
)
  .replace("BEGIN;", "")
  .replace(/COMMIT;\s*$/, "");
const origin = (
  await readFile(
    new URL("supabase/migrations/009_finance_commission_origin.sql", root),
    "utf8",
  )
)
  .replace("BEGIN;", "")
  .replace(/COMMIT;\s*$/, "");
sql = sql
  .replace(
    "BEGIN;",
    () =>
      `BEGIN;\nDO $$ BEGIN IF to_regclass('public.ops_clients') IS NULL OR to_regclass('public.fin_entries') IS NOT NULL THEN RAISE EXCEPTION 'Requires exact schema 006; do not reapply';END IF;END $$;`,
  )
  .replace(
    /COMMIT;\s*$/,
    () => mrr + "\n" + origin + "\n" + checks + "\nCOMMIT;\n",
  );
const output = resolve(
  process.argv.find((v) => v.startsWith("--output="))?.slice(9) ??
    "/tmp/ion-os-finance-release",
);
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(resolve(output, "finance-release.sql"), sql, { mode: 0o600 });
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(
    {
      migrations: [
        "007_finance.sql",
        "008_finance_historical_mrr.sql",
        "009_finance_commission_origin.sql",
      ],
      sha256: createHash("sha256").update(sql).digest("hex"),
      remote_execution: false,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log("Finance release package prepared locally. No remote execution.");
