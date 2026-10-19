"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { financeAdmin } from "@/lib/finance-server";
import {
  entrySchema,
  scheduleSchema,
  ruleSchema,
  settlementSchema,
  dateInput,
} from "@/lib/finance";
function notice(path: string, message: string, error = false): never {
  redirect(
    path +
      (path.includes("?") ? "&" : "?") +
      (error ? "error" : "success") +
      "=" +
      encodeURIComponent(message),
  );
}
async function run(
  fn: string,
  schema: z.ZodType,
  form: FormData,
  path = "/finance",
) {
  const { db } = await financeAdmin();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    notice(
      path,
      "Revise campos obrigatórios, datas e valores (ex.: 1250.50).",
      true,
    );
  const r = await db.rpc(fn, { data: parsed.data });
  if (r.error)
    notice(
      path,
      r.error.code === "P0001"
        ? r.error.message
        : r.error.code === "23505"
          ? "Registro duplicado. Revise o cadastro existente."
          : "Não foi possível salvar. Revise os dados.",
      true,
    );
  revalidatePath("/", "layout");
  return r.data;
}
export async function saveEntry(f: FormData) {
  const existing = z.string().uuid().safeParse(f.get("id"));
  const path = existing.success
    ? "/finance/entries/" + existing.data
    : "/finance?view=" + (f.get("kind") === "expense" ? "expense" : "income");
  const id = await run("fin_save_entry", entrySchema, f, path);
  notice("/finance/entries/" + id, "Lançamento salvo e auditado.");
}
export async function settle(f: FormData) {
  const id = z.string().uuid().safeParse(f.get("entry_id"));
  const path = id.success ? "/finance/entries/" + id.data : "/finance";
  await run("fin_settle", settlementSchema, f, path);
  notice(path, "Liquidação ou estorno registrado. Histórico preservado.");
}
export async function saveSchedule(f: FormData) {
  await run("fin_save_schedule", scheduleSchema, f);
  notice(
    "/finance",
    "Recorrência salva. Gere as parcelas explicitamente; lançamentos existentes foram preservados.",
  );
}
export async function generate(f: FormData) {
  const n = await run(
    "fin_generate",
    z.object({ id: z.string().uuid(), from: dateInput, to: dateInput }),
    f,
  );
  notice("/finance", `${n} parcelas geradas, sem duplicar ciclos existentes.`);
}
export async function saveRule(f: FormData) {
  await run("fin_save_rule", ruleSchema, f);
  notice(
    "/finance",
    "Regra salva. Comissões existentes não foram recalculadas.",
  );
}
export async function commissions(f: FormData) {
  const n = await run(
    "fin_commissions",
    z.object({
      contract_id: z.string().uuid(),
      due_at: dateInput,
      rule_id: z.union([z.string().uuid(), z.literal("")]),
    }),
    f,
  );
  notice(
    "/finance",
    `${n} comissões aprovadas, registradas uma única vez nas despesas.`,
  );
}
