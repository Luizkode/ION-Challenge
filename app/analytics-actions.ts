"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { analyticsContext, analyticsFilters } from "@/lib/analytics-server";
import {
  accountSchema,
  campaignSchema,
  metricSchema,
  parsePerformanceCSV,
  metricKeys,
} from "@/lib/analytics";
import { dateInput } from "@/lib/finance";
function notice(path: string, message: string, error = false): never {
  redirect(
    path +
      "?" +
      (error ? "error" : "success") +
      "=" +
      encodeURIComponent(message),
  );
}
function payload(f: FormData) {
  return {
    ...Object.fromEntries(f),
    active: f.get("active") !== "false",
    voided: f.get("voided") === "true",
    published: f.get("published") === "true",
    can_write: f.get("can_write") === "true",
    confirm: f.get("confirm") === "true" ? "true" : "false",
    metrics: f.getAll("metrics").map(String),
  };
}
async function execute(
  fn: string,
  schema: z.ZodType,
  f: FormData,
  admin = false,
  path = "/analytics",
) {
  const { db, profile } = await analyticsContext();
  if (admin && profile.category !== "admin")
    notice(
      "/analytics",
      "Somente o administrador pode publicar ou conceder acesso.",
      true,
    );
  const p = schema.safeParse(payload(f));
  if (!p.success)
    notice(
      path,
      "Revise os campos obrigatórios, as datas e a comprovação das métricas.",
      true,
    );
  const r = await db.rpc(fn, { data: p.data });
  if (r.error)
    notice(
      path,
      r.error.code === "P0001"
        ? r.error.message
        : r.error.code === "23505"
          ? "Registro já cadastrado. Corrija o existente."
          : "Não foi possível salvar. Revise os campos e sua permissão.",
      true,
    );
  revalidatePath("/", "layout");
  return r.data;
}
export async function saveAdAccount(f: FormData) {
  await execute("ana_save_account", accountSchema, f);
  notice(
    "/analytics",
    "Conta de dados salva. Integração automática permanece desativada.",
  );
}
export async function saveAdCampaign(f: FormData) {
  await execute("ana_save_campaign", campaignSchema, f);
  notice(
    "/analytics",
    "Campanha salva. A publicação depende do administrador.",
  );
}
export async function saveMetric(f: FormData) {
  const parsed = metricSchema.safeParse(payload(f));
  const path =
    parsed.success && parsed.data.id
      ? "/analytics/metrics/" + parsed.data.id
      : "/analytics";
  await execute("ana_save_metric", metricSchema, f, false, path);
  notice(
    "/analytics",
    "Resultado salvo, com origem auditada. Correções revogam publicações afetadas.",
  );
}
export async function importPerformance(f: FormData) {
  const { db } = await analyticsContext();
  const file = f.get("csv");
  if (!(file instanceof File) || file.size < 1 || file.size > 2_000_000)
    notice("/analytics", "Selecione um CSV de até 2 MB.", true);
  let rows;
  try {
    rows = parsePerformanceCSV(
      await file.text(),
      String(f.get("campaign_id") ?? ""),
      String(f.get("source_reference") || file.name),
    );
  } catch (e) {
    notice(
      "/analytics",
      e instanceof Error ? e.message : "CSV inválido.",
      true,
    );
  }
  const r = await db.rpc("ana_import", { rows });
  if (r.error)
    notice(
      "/analytics",
      r.error.code === "P0001"
        ? r.error.message
        : "Importação não concluída. Nenhuma linha foi gravada.",
      true,
    );
  revalidatePath("/", "layout");
  notice(
    "/analytics",
    `${r.data.inserted} resultados importados; ${r.data.unchanged} linhas idênticas preservadas.`,
  );
}
const publication = {
  id: z.string().uuid(),
  published: z.boolean(),
  reason: z.string().trim().min(3).max(2000),
  confirm: z.literal("true"),
};
export async function publishCampaign(f: FormData) {
  await execute(
    "ana_publish_campaign",
    z.object({
      ...publication,
      metrics: z.array(
        z.enum(
          metricKeys as [
            (typeof metricKeys)[number],
            ...(typeof metricKeys)[number][],
          ],
        ),
      ),
    }),
    f,
    true,
  );
  notice(
    "/analytics",
    "Visibilidade da campanha atualizada. Relatórios afetados precisam de nova publicação.",
  );
}
export async function publishMetrics(f: FormData) {
  await execute(
    "ana_publish_metrics",
    z.object({
      campaign_id: z.string().uuid(),
      from: dateInput,
      to: dateInput,
      published: z.boolean(),
      reason: z.string().min(3).max(2000),
      confirm: z.literal("true"),
    }),
    f,
    true,
  );
  notice("/analytics", "Visibilidade dos resultados atualizada e auditada.");
}
export async function publishReport(f: FormData) {
  await execute("ana_publish_report", z.object(publication), f, true);
  notice("/analytics", "Publicação do relatório atualizada e auditada.");
}
export async function createAnalyticsReport(f: FormData) {
  const { db } = await analyticsContext();
  let data;
  try {
    data = {
      ...analyticsFilters(
        Object.fromEntries([...f].map(([k, v]) => [k, String(v)])),
      ),
      title: String(f.get("title") ?? ""),
    };
  } catch {
    notice("/analytics", "Período do relatório inválido.", true);
  }
  if (
    !z.string().uuid().safeParse(data.company_id).success ||
    data.title.trim().length < 3 ||
    data.title.length > 200
  )
    notice(
      "/analytics",
      "Selecione um cliente e informe um título para o relatório.",
      true,
    );
  const r = await db.rpc("ana_create_report", { data });
  if (r.error)
    notice(
      "/analytics",
      r.error.code === "P0001"
        ? r.error.message
        : "Não foi possível gerar o relatório.",
      true,
    );
  revalidatePath("/", "layout");
  redirect("/analytics/reports/" + r.data);
}
export async function saveAnalyticsGrant(f: FormData) {
  await execute(
    "ana_save_grant",
    z.object({
      company_id: z.string().uuid(),
      profile_id: z.string().uuid(),
      can_write: z.boolean(),
      active: z.boolean(),
      reason: z.string().min(3).max(2000),
    }),
    f,
    true,
  );
  notice(
    "/analytics",
    "Permissão de Analytics atualizada. Os vínculos com o cliente continuam obrigatórios.",
  );
}
