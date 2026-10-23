"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { session } from "@/lib/session";
import {
  validateAccess,
  teamDatabaseError,
  invitationError,
  type TeamResult,
} from "@/lib/access-input";
async function admin() {
  const ctx = await session();
  if (ctx.profile.category !== "admin") redirect("/");
  return ctx;
}
export async function saveAccess(form: FormData): Promise<TeamResult> {
  const { db } = await admin();
  const parsed = validateAccess(form, "edit");
  if (!parsed.input.success || Object.keys(parsed.fields).length)
    return {
      ok: false,
      kind: "validation",
      message: "Corrija os campos indicados antes de salvar.",
      fields: parsed.fields,
    };
  const { error } = await db.rpc("manage_access", { data: parsed.input.data });
  if (error) return teamDatabaseError(error);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      "Acesso atualizado. Funções, vínculos e permissões foram aplicados e auditados.",
  };
}
export async function createAccessCompany(form: FormData) {
  const { db } = await admin();
  const parsed = z.string().trim().min(2).max(150).safeParse(form.get("name"));
  if (!parsed.success)
    redirect(
      "/team?error=Informe+um+nome+de+empresa+entre+2+e+150+caracteres.",
    );
  const { error } = await db.rpc("manage_access_company", {
    data: { name: parsed.data },
  });
  if (error)
    redirect(
      "/team?error=" + encodeURIComponent(teamDatabaseError(error).message),
    );
  revalidatePath("/", "layout");
  redirect("/team?success=Empresa+cadastrada+para+vínculos+de+acesso.");
}
export async function inviteAccess(form: FormData): Promise<TeamResult> {
  const { db } = await admin();
  const parsed = validateAccess(form, "invite");
  if (
    !parsed.input.success ||
    !parsed.email.success ||
    Object.keys(parsed.fields).length
  )
    return {
      ok: false,
      kind: "validation",
      message: "Corrija os campos indicados antes de enviar o convite.",
      fields: parsed.fields,
    };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl =
    process.env.ION_OS_APP_URL ||
    (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : undefined);
  if (!serviceKey || !appUrl)
    return {
      ok: false,
      kind: "infrastructure",
      message:
        "O envio de convites não está configurado no servidor. O administrador deve verificar a configuração de autenticação e email.",
      fields: {},
    };
  let callback: string;
  try {
    const url = new URL(appUrl);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && url.hostname !== "localhost")
    )
      throw Error();
    callback = new URL("/auth/callback", url).toString();
  } catch {
    return {
      ok: false,
      kind: "infrastructure",
      message:
        "O endereço de retorno dos convites está inválido. O administrador deve conferir o endereço da aplicação na configuração do servidor.",
      fields: {},
    };
  }
  const { data: iid, error: beginError } = await db.rpc("begin_access_invite", {
    data: { ...parsed.input.data, email: parsed.email.data },
  });
  if (beginError) return teamDatabaseError(beginError);
  const authAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let result: Awaited<
    ReturnType<typeof authAdmin.auth.admin.inviteUserByEmail>
  >;
  try {
    result = await authAdmin.auth.admin.inviteUserByEmail(parsed.email.data, {
      redirectTo: callback,
    });
  } catch {
    return {
      ok: false,
      kind: "uncertain",
      message:
        "A conexão caiu antes da confirmação do convite. O histórico ficou pendente para conferência; não repita o envio sem verificar o Auth e o histórico de convites.",
      fields: {},
    };
  }
  const { data: invited, error } = result;
  if (error || !invited.user) {
    // A network timeout can occur after Auth accepted the request: retain pending state for reconciliation.
    if (error?.name === "AuthRetryableFetchError" || error?.status === 0)
      return {
        ok: false,
        kind: "uncertain",
        message:
          "Não foi possível confirmar o resultado do envio. Confira o Auth e o convite pendente antes de tentar novamente.",
        fields: {},
      };
    const failed = await db.rpc("fail_access_invite", { invitation_id: iid });
    revalidatePath("/team");
    if (failed.error)
      return {
        ok: false,
        kind: "uncertain",
        message:
          "O envio falhou e o histórico não confirmou a atualização. Recarregue o histórico antes de repetir o convite.",
        fields: {},
      };
    return invitationError(error ?? {});
  }
  const { error: completeError } = await db.rpc("complete_access_invite", {
    invitation_id: iid,
    uid: invited.user.id,
  });
  if (completeError) {
    // Record this known access-configuration failure; never delete an existing Auth user.
    const failed = await db.rpc("fail_access_invite", { invitation_id: iid });
    revalidatePath("/team");
    if (failed.error)
      return {
        ok: false,
        kind: "uncertain",
        message:
          "O Auth aceitou o convite, mas a configuração do acesso e a atualização do histórico não foram confirmadas. Confira o usuário Auth e o histórico antes de reenviar.",
        fields: {},
      };
    return {
      ok: false,
      kind: "uncertain",
      message:
        "O Auth aceitou o convite, mas a configuração do acesso não foi confirmada. Confira primeiro se o perfil já existe; se faltar, consulte o histórico e use “Vincular conta existente” com o UUID " +
        invited.user.id +
        ". " +
        teamDatabaseError(completeError).message,
      fields: {},
    };
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      "Convite enviado e acesso configurado. O Supabase aceitou o envio; confirme o recebimento com a pessoa convidada. O cadastro não comprova a entrega na caixa de email.",
  };
}
