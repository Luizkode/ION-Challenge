"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { session } from "@/lib/session";
import {
  lifecycleSchema,
  type LifecycleInspection,
} from "@/lib/user-lifecycle";
import { teamDatabaseError, type TeamResult } from "@/lib/access-input";
async function admin() {
  const ctx = await session();
  if (ctx.profile.category !== "admin")
    throw new Error("Acesso restrito ao administrador.");
  return ctx;
}
export async function inspectLifecycle(
  id: string,
): Promise<{ data?: LifecycleInspection; error?: string }> {
  const { db } = await admin();
  if (!z.string().guid().safeParse(id).success)
    return { error: "UUID inválido." };
  const r = await db.rpc("inspect_user_lifecycle", { uid: id });
  return r.error
    ? { error: teamDatabaseError(r.error).message }
    : { data: r.data };
}
export async function cancelLifecycle(id: string): Promise<TeamResult> {
  const { db } = await admin();
  if (!z.string().guid().safeParse(id).success)
    return {
      ok: false,
      kind: "validation",
      fields: {},
      message: "Solicitação inválida.",
    };
  const r = await db.rpc("cancel_user_lifecycle", { request_id: id });
  if (r.error) return teamDatabaseError(r.error);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      "Solicitação encerrada. O acesso permanece desativado; nenhuma permissão foi restaurada automaticamente.",
  };
}
export async function executeLifecycle(form: FormData): Promise<TeamResult> {
  const { db } = await admin();
  const p = lifecycleSchema.safeParse(Object.fromEntries(form));
  if (!p.success) {
    const fields: Record<string, string[]> = {};
    for (const i of p.error.issues)
      (fields[String(i.path[0])] ??= []).push(i.message);
    return {
      ok: false,
      kind: "validation",
      fields,
      message: "Confira os campos e as confirmações.",
    };
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (p.data.mode !== "deactivate" && !serviceKey)
    return {
      ok: false,
      kind: "infrastructure",
      fields: {},
      message:
        "A remoção de identidade não está configurada no servidor. Nenhuma alteração foi executada.",
    };
  const prepared = await db.rpc("prepare_user_lifecycle", { data: p.data });
  if (prepared.error) return teamDatabaseError(prepared.error);
  if (prepared.data.status !== "completed") {
    const authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    try {
      const removed = await authAdmin.auth.admin.deleteUser(
        p.data.target_id,
        false,
      );
      if (removed.error)
        return {
          ok: false,
          kind: "uncertain",
          fields: {},
          message:
            "O Auth não confirmou a remoção. O acesso permanece inativo e a solicitação foi preservada. Consulte as dependências e tente novamente, ou encerre a solicitação. Nenhum histórico comercial foi excluído.",
        };
    } catch {
      return {
        ok: false,
        kind: "uncertain",
        fields: {},
        message:
          "A conexão caiu antes da confirmação. A solicitação foi preservada para conferência e repetição segura; o acesso permanece inativo.",
      };
    }
    // Completion is committed by the Auth deletion trigger, in the same DB transaction.
    const verified = await db.rpc("prepare_user_lifecycle", { data: p.data });
    if (verified.error || verified.data?.status !== "completed")
      return {
        ok: false,
        kind: "uncertain",
        fields: {},
        message:
          "Confira a solicitação no histórico antes de executar outra operação: não foi possível confirmar sua conclusão.",
      };
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      p.data.mode === "deactivate"
        ? "Acesso desativado. Identidade e histórico preservados."
        : p.data.mode === "anonymize"
          ? "Identidade de login removida e nome cadastral anonimizado. Perfil, resultados e auditoria preservados; isso não elimina dados pessoais existentes nos documentos históricos."
          : "Conta de teste sem histórico removida do Auth e da Equipe. Auditoria e histórico de convites preservados.",
  };
}
