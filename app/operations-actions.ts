"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { session } from "@/lib/session";
import { operationsContext, operationsAdmin } from "@/lib/operations-server";
import {
  clientSchema,
  contractSchema,
  serviceSchema,
  formObject,
  fileSchema,
} from "@/lib/operations";
function notice(path: string, message: string, error = false): never {
  redirect(
    path +
      "?" +
      (error ? "error" : "success") +
      "=" +
      encodeURIComponent(message),
  );
}
function safeError(e: { code?: string; message: string }) {
  return e.code === "P0001"
    ? e.message
    : e.code === "23505"
      ? "Registro duplicado. Revise os dados existentes."
      : "Não foi possível salvar. Revise os campos e tente novamente.";
}
function pathFor(id: unknown) {
  return z.string().guid().safeParse(id).success
    ? "/clients/" + id
    : "/clients";
}
async function execute(fn: string, data: unknown, path: string, admin = true) {
  const { db } = await (admin ? operationsAdmin() : operationsContext());
  const r = await db.rpc(fn, { data });
  if (r.error) notice(path, safeError(r.error), true);
  revalidatePath("/", "layout");
  return r.data;
}
export async function saveClient(form: FormData) {
  const p = clientSchema.safeParse(formObject(form));
  if (!p.success)
    notice(
      z.string().guid().safeParse(form.get("company_id")).success
        ? pathFor(form.get("company_id"))
        : "/clients/new",
      "Revise os campos do cliente, datas e responsáveis.",
      true,
    );
  const id = await execute(
    "ops_save_client",
    p.data,
    p.data.company_id ? pathFor(p.data.company_id) : "/clients/new",
  );
  notice("/clients/" + id, "Cliente salvo e histórico preservado.");
}
export async function saveContract(form: FormData) {
  const p = contractSchema.safeParse(formObject(form));
  if (!p.success)
    notice(
      "/clients",
      "Revise identificação, datas, valor e responsável do contrato.",
      true,
    );
  await execute("ops_save_contract", p.data, pathFor(p.data.company_id));
  notice(pathFor(p.data.company_id), "Contrato salvo e auditado.");
}
export async function saveService(form: FormData) {
  const p = serviceSchema.safeParse(formObject(form));
  if (!p.success)
    notice("/clients", "Revise os dados e responsáveis do serviço.", true);
  await execute("ops_save_service", p.data, pathFor(p.data.company_id));
  notice(pathFor(p.data.company_id), "Serviço e atribuições salvos.");
}
export async function convertDeal(form: FormData) {
  const p = z
    .object({
      deal_id: z.string().guid(),
      responsible_id: z.union([z.string().guid(), z.literal("")]).optional(),
      company_id: z.union([z.string().guid(), z.literal("")]).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success)
    notice("/clients", "Selecione um fechamento confirmado.", true);
  const id = await execute("ops_from_crm", p.data, "/clients");
  notice(
    "/clients/" + id,
    "Cliente e contrato vinculados ao CRM sem duplicação.",
  );
}
export async function saveCatalog(form: FormData) {
  const p = z
    .object({
      id: z.union([z.string().guid(), z.literal("")]).optional(),
      name: z.string().trim().min(2).max(150),
      active: z.enum(["true", "false"]).default("true"),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) notice("/clients", "Revise o serviço do catálogo.", true);
  await execute("ops_save_catalog", p.data, "/clients");
  notice("/clients", "Catálogo atualizado.");
}
export async function progressService(form: FormData) {
  const p = z
    .object({
      company_id: z.string().guid(),
      service_id: z.string().guid(),
      version: z.coerce.number().int().positive(),
      status: z.enum(["pending", "running", "completed", "paused"]),
      delivered_at: z.string().optional(),
      body: z.string().trim().min(1).max(4000),
      partner_body: z.string().max(4000).default(""),
      published: z.boolean(),
    })
    .safeParse(formObject(form));
  if (!p.success) notice("/clients", "Revise a atualização do serviço.", true);
  await execute("ops_progress", p.data, pathFor(p.data.company_id), false);
  notice(pathFor(p.data.company_id), "Andamento registrado.");
}
export async function publishUpdate(form: FormData) {
  const p = z
    .object({
      id: z.string().guid(),
      company_id: z.string().guid(),
      partner_body: z.string().max(4000),
      published: z.boolean(),
    })
    .safeParse(formObject(form));
  if (!p.success) notice("/clients", "Revise o texto público.", true);
  await execute("ops_publish_update", p.data, pathFor(p.data.company_id));
  notice(pathFor(p.data.company_id), "Publicação atualizada.");
}
export async function reconcileSource(form: FormData) {
  const p = z
    .object({
      id: z.string().guid(),
      company_id: z.string().guid(),
      decision: z.enum(["keep", "paused", "cancelled"]),
      confirm: z.literal("true"),
      reason: z.string().trim().min(8).max(4000),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success)
    notice("/clients", "Confirme a decisão e justifique a revisão.", true);
  await execute("ops_reconcile", p.data, pathFor(p.data.company_id));
  notice(
    pathFor(p.data.company_id),
    "Origem comercial revisada. Registros operacionais preservados.",
  );
}
export async function reserveFile(
  input: unknown,
): Promise<{ error?: string; id?: string; path?: string; bucket?: string }> {
  const { db } = await operationsContext();
  const p = fileSchema.safeParse(input);
  if (!p.success)
    return {
      error: "Arquivo inválido: até 10 MB, PDF, imagens, texto, DOCX ou XLSX.",
    };
  const r = await db.rpc("ops_begin_file", { data: p.data });
  if (r.error) return { error: safeError(r.error) };
  return r.data;
}
export async function finishFile(id: string): Promise<{ error?: string }> {
  const { db } = await operationsContext();
  if (!z.string().guid().safeParse(id).success)
    return { error: "Envio inválido." };
  const r = await db.rpc("ops_finish_file", { data: { id } });
  if (r.error) return { error: safeError(r.error) };
  revalidatePath("/", "layout");
  return {};
}
export async function manageFile(form: FormData) {
  const p = z
    .object({
      id: z.string().guid(),
      company_id: z.string().guid(),
      state: z.enum(["ready", "archived"]),
      partner_visible: z.boolean(),
    })
    .safeParse(formObject(form));
  if (!p.success) notice("/clients", "Revise o documento.", true);
  await execute("ops_manage_file", p.data, pathFor(p.data.company_id));
  notice(pathFor(p.data.company_id), "Visibilidade do documento atualizada.");
}
export async function downloadFile(
  id: string,
): Promise<{ error?: string; url?: string }> {
  const { db } = await session();
  if (!z.string().guid().safeParse(id).success)
    return { error: "Documento inválido." };
  const record = await db.rpc("ops_download", { fid: id });
  if (record.error)
    return { error: "Documento indisponível ou sem permissão." };
  return { url: "/clients/files/" + id };
}
