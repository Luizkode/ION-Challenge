"use server";
import { hasFunction } from "@/lib/access";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase";
import { session } from "@/lib/session";
import { meetingSchema } from "@/lib/meeting-registration";
function jump(path: string, message: string, kind = "error"): never {
  redirect(path + "?" + kind + "=" + encodeURIComponent(message));
}
export async function login(form: FormData) {
  if (!configured())
    jump("/login", "Configure as variáveis do Supabase para continuar.");
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(8) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) jump("/login", "Informe email e senha válidos.");
  const db = await supabase();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error)
    jump("/login", "Não foi possível entrar. Verifique suas credenciais.");
  redirect("/");
}
export async function logout() {
  const db = await supabase();
  // End this browser's session without unexpectedly signing out other devices.
  try {
    await db.auth.signOut({ scope: "local" });
  } catch {
    /* Clear this browser even when Auth is temporarily unreachable. */
  }
  const jar = await cookies();
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
    ".",
  )[0];
  for (const cookie of jar.getAll())
    if (cookie.name.startsWith("sb-" + project + "-auth-token"))
      jar.delete(cookie.name);
  redirect("/login");
}
export async function changePassword(form: FormData) {
  const { db } = await session();
  const password = String(form.get("password"));
  if (password.length < 12)
    jump("/account", "Use uma senha de pelo menos 12 caracteres.");
  const { error } = await db.auth.updateUser({ password });
  if (error) jump("/account", "Não foi possível atualizar a senha.");
  jump("/account", "Senha atualizada.", "success");
}
export async function createMeeting(form: FormData) {
  const { db, profile } = await session();
  if (!hasFunction(profile, "sdr"))
    jump("/meetings", "Apenas SDRs podem cadastrar reuniões.");
  const result = meetingSchema.safeParse(Object.fromEntries(form));
  if (!result.success)
    jump(
      "/meetings/new",
      "Revise os campos: informe os dados da empresa, data e horário válidos e selecione um closer.",
    );
  const { error } = await db.rpc("create_meeting", { data: result.data });
  if (error) jump("/meetings/new", error.message);
  revalidatePath("/", "layout");
  jump(
    "/meetings",
    "Reunião cadastrada como Agendada. Ainda não gera pontos.",
    "success",
  );
}
export async function validateMeeting(form: FormData) {
  const { db } = await session();
  const data = Object.fromEntries(form);
  const { error } = await db.rpc("validate_meeting", { data });
  if (error) jump("/validation", error.message);
  revalidatePath("/", "layout");
  jump(
    "/validation",
    "Validação registrada e indicadores atualizados.",
    "success",
  );
}
export async function adminOperation(form: FormData) {
  const { db, profile } = await session();
  if (profile.role !== "admin") redirect("/");
  const data = Object.fromEntries(form);
  const operation = String(data.operation);
  delete data.operation;
  const { error } = await db.rpc("admin_operation", { operation, data });
  const path = ["correct_meeting", "duplicate_exception"].includes(operation)
    ? "/meetings"
    : "/admin";
  if (error) jump(path, error.message);
  revalidatePath("/", "layout");
  const message =
    operation === "participant"
      ? data.remove === "true"
        ? "Participante removido da campanha e dos rankings. Histórico preservado."
        : "Participante adicionado à campanha. Rankings atualizados."
      : operation === "profile"
        ? data.remove_from_campaign === "true"
          ? "Perfil atualizado e participação removida na mesma operação. Histórico preservado."
          : "Perfil atualizado. Permissões aplicadas às próximas operações."
        : "Alteração salva e auditada.";
  jump(path, message, "success");
}
