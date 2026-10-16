"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { session } from "@/lib/session";
import { canAccessModule } from "@/lib/os-modules";
import { leadSchema, meetingInput, dealInput } from "@/lib/crm";
async function context() {
  const s = await session();
  if (!canAccessModule("crm", s.profile)) redirect("/?error=Sem+acesso+ao+CRM");
  return s;
}
function done(path: string, message: string, error = false): never {
  redirect(
    path +
      "?" +
      (error ? "error" : "success") +
      "=" +
      encodeURIComponent(message),
  );
}
function errorText(code?: string, message?: string) {
  if (code === "23505")
    return "Registro duplicado. Consulte o cadastro existente.";
  if (code === "P0001") return message ?? "Operação bloqueada.";
  return "Não foi possível salvar. Revise os dados e tente novamente.";
}
async function execute(fn: string, data: unknown, path: string) {
  const { db } = await context();
  const result = await db.rpc(fn, { data });
  if (result.error)
    done(path, errorText(result.error.code, result.error.message), true);
  revalidatePath("/", "layout");
  return result.data;
}
export async function saveLead(form: FormData) {
  const raw = Object.fromEntries(form);
  const id = z.string().uuid().safeParse(raw.id);
  const path = id.success ? "/crm/" + id.data : "/crm/new";
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success)
    done(path, "Revise os campos obrigatórios, WhatsApp, email e UF.", true);
  const saved = await execute("crm_save_lead", parsed.data, path);
  done("/crm/" + saved, "Lead salvo.");
}
export async function addActivity(form: FormData) {
  const parsed = z
    .object({
      lead_id: z.string().uuid(),
      kind: z.enum(["contact", "response", "note", "stage"]),
      version: z.coerce.number().int().positive().optional(),
      channel: z.string().max(80),
      description: z.string().trim().min(1).max(4000),
      stage: z.string().optional(),
      follow_up_at: z
        .union([z.literal(""), z.string().datetime({ offset: true })])
        .optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) done("/crm", "Revise a atividade.", true);
  await execute("crm_activity", parsed.data, "/crm/" + parsed.data.lead_id);
  done("/crm/" + parsed.data.lead_id, "Atividade registrada.");
}
export async function scheduleCrm(form: FormData) {
  const parsed = meetingInput.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    done("/crm", "Informe data, horário e closer válidos.", true);
  await execute(
    "crm_schedule_meeting",
    parsed.data,
    "/crm/" + parsed.data.lead_id,
  );
  done(
    "/crm/" + parsed.data.lead_id,
    "Reunião agendada. Pontos somente após validação elegível.",
  );
}
export async function recordDeal(form: FormData) {
  const parsed = dealInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) done("/crm", "Revise valor, serviços e prazo.", true);
  await execute("crm_record_deal", parsed.data, "/crm/" + parsed.data.lead_id);
  done(
    "/crm/" + parsed.data.lead_id,
    "Negociação registrada. Fechamentos aguardam confirmação administrativa para pontuação.",
  );
}
export async function archiveLead(form: FormData) {
  const parsed = z
    .object({
      id: z.string().uuid(),
      archived: z.enum(["true", "false"]),
      confirm: z.literal("true"),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) done("/crm", "Confirme o arquivamento.", true);
  await execute("crm_archive", parsed.data, "/crm/" + parsed.data.id);
  done(
    "/crm/" + parsed.data.id,
    "Arquivamento atualizado. Histórico preservado.",
  );
}
export async function validateCrm(form: FormData) {
  const p = z
    .object({
      id: z.string().uuid(),
      lead_id: z.string().uuid(),
      attended: z.enum(["true", "false"]),
      qualified: z.enum(["true", "false"]),
      notes: z.string().max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) done("/crm", "Dados inválidos de validação.", true);
  await execute("validate_meeting", p.data, "/crm/" + p.data.lead_id);
  done(
    "/crm/" + p.data.lead_id,
    "Validação registrada pelo fluxo oficial do Challenger.",
  );
}
export async function confirmCrm(form: FormData) {
  const p = z
    .object({
      lead_id: z.string().uuid(),
      deal_id: z.string().uuid(),
      meeting_id: z.string().uuid(),
      closed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reference: z.string().trim().min(3).max(150),
      notes: z.string().max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) done("/crm", "Revise os dados do contrato.", true);
  await execute("crm_confirm_contract", p.data, "/crm/" + p.data.lead_id);
  done(
    "/crm/" + p.data.lead_id,
    "Contrato confirmado sem duplicação de pontuação.",
  );
}
export async function importLeads(
  input: unknown,
): Promise<{ error?: string; count?: number }> {
  const { db } = await context();
  const parsed = z
    .array(leadSchema.omit({ id: true, version: true }))
    .min(1)
    .max(500)
    .safeParse(input);
  if (!parsed.success) return { error: "Arquivo inválido. Revise a prévia." };
  const r = await db.rpc("crm_import_leads", { rows: parsed.data });
  if (r.error) return { error: errorText(r.error.code, r.error.message) };
  revalidatePath("/", "layout");
  return { count: r.data };
}
export async function moveLead(
  id: string,
  stage: string,
): Promise<{ error?: string }> {
  const { db } = await context();
  if (
    !z.string().uuid().safeParse(id).success ||
    !["new", "contacted", "replied", "interested", "lost"].includes(stage)
  )
    return {
      error: "Use o formulário de reunião ou negociação para esta etapa.",
    };
  const r = await db.rpc("crm_activity", {
    data: {
      lead_id: id,
      kind: "stage",
      stage,
      description: "Etapa alterada pelo funil",
      channel: "",
    },
  });
  if (r.error) return { error: errorText(r.error.code, r.error.message) };
  revalidatePath("/", "layout");
  return {};
}
export async function grantCrm(form: FormData) {
  const { profile } = await context();
  if (profile.category !== "admin") redirect("/");
  const p = z
    .object({
      profile_id: z.string().uuid(),
      enabled: z.enum(["true", "false"]),
      confirm: z.literal("true"),
      reason: z.string().trim().min(8).max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success)
    done("/crm", "Confirme o acesso e informe justificativa.", true);
  await execute("crm_set_grant", p.data, "/crm");
  done("/crm", "Permissão de consulta e atividades atualizada e auditada.");
}
