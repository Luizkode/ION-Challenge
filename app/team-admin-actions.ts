"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { session } from "@/lib/session";
import { authAdministrator } from "@/lib/admin-auth";
import { recoveryClient } from "@/lib/recovery-client";
import { recoveryCallback } from "@/lib/auth-recovery";
import { teamDatabaseError, type TeamResult } from "@/lib/access-input";
const validId = z.string().guid();
const fail = (
  message: string,
  kind: "validation" | "infrastructure" | "uncertain" = "validation",
): TeamResult => ({ ok: false, kind, message, fields: {} });
async function admin() {
  const s = await session();
  if (s.profile.category !== "admin")
    throw Error("Acesso restrito ao administrador.");
  return s;
}
export async function removeTeamUser(
  id: string,
  requestId: string,
): Promise<TeamResult> {
  const { db } = await admin();
  if (!validId.safeParse(id).success || !validId.safeParse(requestId).success)
    return fail("Conta inválida. Recarregue a Equipe.");
  const privileged = authAdministrator();
  if (!privileged)
    return fail(
      "A remoção não está disponível no servidor. Nenhum acesso foi alterado.",
      "infrastructure",
    );
  const prepared = await db.rpc("prepare_simple_removal", {
    uid: id,
    request_id: requestId,
  });
  if (prepared.error) return teamDatabaseError(prepared.error);
  let done = prepared.data?.status === "completed";
  if (!done) {
    try {
      await privileged.auth.admin.deleteUser(id, false);
    } catch {
      /* Pending work is retried by the protected queue, never silently reactivated. */
    }
    const current = await db.rpc("prepare_simple_removal", {
      uid: id,
      request_id: requestId,
    });
    done = !current.error && current.data?.status === "completed";
  }
  revalidatePath("/", "layout");
  return done
    ? {
        ok: true,
        message:
          "Usuário removido. Login e vínculos pessoais encerrados; histórico necessário preservado com identificação anônima.",
      }
    : fail(
        "O acesso já foi bloqueado. A remoção está em processamento e será tentada novamente automaticamente.",
        "uncertain",
      );
}
export async function toggleTeamAccess(
  id: string,
  active: boolean,
): Promise<TeamResult> {
  const { db } = await admin();
  if (!validId.safeParse(id).success || typeof active !== "boolean")
    return fail("Conta inválida.");
  const [p, f, c, partners] = await Promise.all([
    db.from("profiles").select("id,name,category").eq("id", id).single(),
    db.from("user_functions").select("function_code").eq("profile_id", id),
    db.from("client_assignments").select("company_id").eq("profile_id", id),
    db.from("partner_companies").select("company_id").eq("profile_id", id),
  ]);
  if (p.error || f.error || c.error || partners.error || !p.data)
    return fail("Não foi possível consultar a conta.", "infrastructure");
  const r = await db.rpc("team_save_access", {
    data: {
      ...p.data,
      active: String(active),
      functions: f.data?.map((x) => x.function_code) ?? [],
      company_ids: [...(c.data ?? []), ...(partners.data ?? [])].map(
        (x) => x.company_id,
      ),
    },
  });
  if (r.error) return teamDatabaseError(r.error);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: active
      ? "Acesso ativado."
      : "Acesso desativado e sessões revogadas.",
  };
}
export async function manageTeamAuth(
  id: string,
  action: string,
  requestId: string,
): Promise<TeamResult> {
  const { db } = await admin();
  if (
    !validId.safeParse(id).success ||
    !validId.safeParse(requestId).success ||
    !["reset_password", "resend_invite", "revoke_sessions"].includes(action)
  )
    return fail("Ação inválida.");
  const callback = recoveryCallback(process.env),
    privileged = authAdministrator();
  if (action !== "revoke_sessions" && (!privileged || !callback))
    return fail(
      "Verifique a configuração de autenticação e email do servidor.",
      "infrastructure",
    );
  const dir = await db.rpc("team_auth_directory", { ids: [id] });
  const account = dir.data?.[0];
  if (dir.error || !account?.email) return fail("Conta indisponível.");
  if (action === "resend_invite" && !account.invitation_pending)
    return fail(
      "Esta conta já foi ativada ou não tem convite pendente. Use a redefinição de senha.",
    );
  const begun = await db.rpc("begin_team_auth_action", {
    uid: id,
    action,
    request_id: requestId,
  });
  if (begun.error) return teamDatabaseError(begun.error);
  if (begun.data?.status === "completed") {
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        action === "revoke_sessions"
          ? "Sessões revogadas. Será necessário entrar novamente."
          : "Esta solicitação já foi processada.",
    };
  }
  if (begun.data?.status === "failed")
    return fail(
      "Solicitação anterior encerrada. Tente novamente após conferir a configuração de email.",
    );
  let error: unknown = null;
  try {
    if (action === "reset_password")
      error = (
        await recoveryClient().auth.resetPasswordForEmail(account.email, {
          redirectTo: callback!,
        })
      ).error;
    else {
      const r = await privileged!.auth.admin.inviteUserByEmail(account.email, {
        redirectTo: callback!,
      });
      error =
        r.error ??
        (r.data.user?.id === id ? null : new Error("Conta alterada"));
    }
  } catch {
    return fail(
      "O envio não pôde ser confirmado. Confira o histórico antes de repetir.",
      "uncertain",
    );
  }
  const logged = await db.rpc("finish_team_auth_action", {
    request_id: requestId,
    succeeded: !error,
  });
  if (logged.error)
    return fail(
      "Não foi possível confirmar o registro do envio. Confira o histórico antes de repetir.",
      "uncertain",
    );
  revalidatePath("/team");
  return error
    ? fail(
        "O serviço de email não confirmou o envio. Verifique o SMTP do Supabase e tente novamente; o acesso existente foi preservado.",
        "infrastructure",
      )
    : {
        ok: true,
        message:
          "O Supabase aceitou a solicitação de email. Confirme o recebimento com o usuário; isso ainda não comprova a entrega.",
      };
}
