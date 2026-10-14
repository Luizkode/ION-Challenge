"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { session } from "@/lib/session";
import { accessInput, accessForm } from "@/lib/access-input";
function notice(message: string, success = false): never {
  redirect(
    "/team?" +
      (success ? "success" : "error") +
      "=" +
      encodeURIComponent(message),
  );
}
async function admin() {
  const ctx = await session();
  if (ctx.profile.category !== "admin") redirect("/");
  return ctx;
}
export async function saveAccess(form: FormData) {
  const { db } = await admin();
  const parsed = accessInput.safeParse(accessForm(form));
  if (!parsed.success || !parsed.data.id)
    notice(
      "Revise nome, categoria, funções, vínculos, justificativa e confirmação.",
    );
  const { error } = await db.rpc("manage_access", { data: parsed.data });
  if (error) notice(error.message);
  revalidatePath("/", "layout");
  notice(
    "Acesso atualizado. Funções, vínculos e permissões foram aplicados e auditados.",
    true,
  );
}
export async function createAccessCompany(form: FormData) {
  const { db } = await admin();
  const parsed = z.string().trim().min(2).max(150).safeParse(form.get("name"));
  if (!parsed.success)
    notice("Informe um nome de empresa entre 2 e 150 caracteres.");
  const { error } = await db.rpc("manage_access_company", {
    data: { name: parsed.data },
  });
  if (error) notice(error.message);
  revalidatePath("/", "layout");
  notice("Empresa cadastrada para vínculos de acesso.", true);
}
export async function inviteAccess(form: FormData) {
  const { db } = await admin();
  const parsed = accessInput.safeParse(accessForm(form));
  const email = z.string().trim().email().safeParse(form.get("email"));
  if (!parsed.success || !email.success)
    notice("Revise os dados do convite, funções e empresas.");
  // Secret is used only inside this server action, after an authenticated admin check.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl =
    process.env.ION_OS_APP_URL ||
    (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : undefined);
  if (!serviceKey || !appUrl)
    notice(
      "Convites precisam de SUPABASE_SERVICE_ROLE_KEY e ION_OS_APP_URL no servidor. Configure-os de forma segura; nunca use NEXT_PUBLIC para a chave administrativa.",
    );
  let callback: string;
  try {
    const url = new URL(appUrl);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && url.hostname !== "localhost")
    )
      throw new Error();
    callback = new URL("/auth/callback", url).toString();
  } catch {
    notice("ION_OS_APP_URL deve ser uma URL HTTPS válida da aplicação.");
  }
  const { data: iid, error: beginError } = await db.rpc("begin_access_invite", {
    data: { ...parsed.data, email: email.data },
  });
  if (beginError)
    notice(
      beginError.code === "23505"
        ? "Já existe um convite pendente para este email. Revise o histórico de convites."
        : beginError.message,
    );
  const authAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: invited, error } = await authAdmin.auth.admin
    .inviteUserByEmail(email.data, { redirectTo: callback })
    .catch(() => ({
      data: { user: null },
      error: { message: "Falha de conexão" },
    }));
  if (error || !invited.user) {
    await db.rpc("fail_access_invite", { invitation_id: iid });
    notice(
      "Não foi possível enviar o convite. Verifique Auth, SMTP, URL de redirecionamento e se o email já está cadastrado. Nenhuma permissão foi concedida.",
    );
  }
  const { error: completeError } = await db.rpc("complete_access_invite", {
    invitation_id: iid,
    uid: invited.user.id,
  });
  if (completeError) {
    await db.rpc("fail_access_invite", { invitation_id: iid });
    notice(
      "O convite foi enviado, mas o vínculo de acesso não foi concluído. Não excluímos usuários existentes. Revise o histórico e conclua pelo UUID " +
        invited.user.id +
        " antes do uso.",
    );
  }
  revalidatePath("/", "layout");
  notice(
    "Convite enviado e acesso configurado. A pessoa deve abrir o email e definir sua senha.",
    true,
  );
}
