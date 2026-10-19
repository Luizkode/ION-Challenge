// Generate separate phases; never execute remotely or combine policy tightening with phase one.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const output = resolve(
  process.argv.find((v) => v.startsWith("--output="))?.slice(9) ??
    "/tmp/ion-os-analytics-release",
);
await mkdir(output, { recursive: true, mode: 0o700 });
const files = [
  "supabase/migrations/010_analytics_partners.sql",
  "supabase/migrations/011_authenticated_document_downloads.sql",
  "supabase/checks/stage_6_security.sql",
];
const manifest = [];
for (const file of files) {
  const contents = await readFile(new URL(file, root), "utf8"),
    name = file.split("/").pop();
  await writeFile(resolve(output, name), contents, { mode: 0o600 });
  manifest.push({
    file,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(
    {
      remote_execution: false,
      prerequisite: "Verified current recovery copy",
      phase_one: "010 before application deployment",
      phase_two: "011 only after authenticated download route is deployed",
      files: manifest,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log("Analytics release prepared locally in " + output);
