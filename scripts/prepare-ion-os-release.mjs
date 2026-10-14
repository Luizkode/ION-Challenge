// Builds a reviewable SQL artifact. No database connection or remote writes.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function buildRelease(from) {
  if (!["001", "002"].includes(from)) throw new Error("Selecione explicitamente --from=001 ou --from=002 após conferir o inventário.");
  const files = from === "001" ? ["002_participant_management.sql", "003_access_control.sql"] : ["003_access_control.sql"];
  const sources = await Promise.all(files.map(async name => ({ name, text: await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8") })));
  const unwrap = (text, begin = "BEGIN;") => {
    if (text.split("\n").filter(line => line.trim() === begin).length !== 1 || !/\nCOMMIT;\s*$/.test(text)) throw new Error("Limites transacionais inesperados; revise o gerador.");
    return text.replace(begin, "").replace(/\nCOMMIT;\s*$/, "\n");
  };
  const guard = `DO $$ BEGIN
 IF to_regclass('public.profiles') IS NULL OR to_regclass('public.opportunity_scores') IS NULL THEN RAISE EXCEPTION 'Estrutura 001 ausente; não reaplique 001'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='category') OR to_regclass('public.user_functions') IS NOT NULL OR to_regprocedure('public.admin_operation_v2(text,jsonb)') IS NOT NULL THEN RAISE EXCEPTION '003 já aplicada ou estado parcial; interrompa e confira o inventário'; END IF;
 IF (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_participants' AND column_name='removed_at')) IS DISTINCT FROM ${from === "002"} THEN RAISE EXCEPTION 'Estado do banco diverge da versão de origem selecionada'; END IF;
 IF (to_regprocedure('public.admin_operation_v1(text,jsonb)') IS NOT NULL) IS DISTINCT FROM ${from === "002"} THEN RAISE EXCEPTION 'Funções administrativas divergem da versão de origem'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE role='admin' AND active) THEN RAISE EXCEPTION 'Não há administrador ativo; não executar bootstrap automático'; END IF;
END $$;`;
  const security = await readFile(new URL("../supabase/checks/stage_2_security.sql", import.meta.url), "utf8");
  const sql = "-- Generated release for the existing project; requires production authorization and verified backup.\nBEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '120s';\nSELECT pg_advisory_xact_lock(70013);\n" + guard + "\n" + sources.map(s => `\n-- Source: ${s.name}\n${unwrap(s.text)}`).join("\n") + "\n-- Acceptance checks inside the SAME transaction.\n" + unwrap(security, "BEGIN READ ONLY;") + "\nCOMMIT;\n";
  const hash = text => createHash("sha256").update(text).digest("hex");
  return { sql, manifest: { from, migrations: sources.map(s => ({ name: s.name, sha256: hash(s.text) })), security_sha256: hash(security), release_sha256: hash(sql), applies_001: false, remote_execution: false } };
}

async function main() {
  const from = process.argv.find(a => a.startsWith("--from="))?.slice(7);
  const output = resolve(process.argv.find(a => a.startsWith("--output="))?.slice(9) ?? "/tmp/ion-os-release");
  const release = await buildRelease(from);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(resolve(output, "ion-os-release.sql"), release.sql, { mode: 0o600 });
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(release.manifest, null, 2) + "\n", { mode: 0o600 });
  console.log("Artefatos locais preparados em " + output + ". Nenhuma migration executada.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Não foi possível preparar os artefatos. Confira --from=001/002, fontes e diretório de saída."); process.exitCode = 1; });
}
