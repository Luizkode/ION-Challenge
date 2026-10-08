"use server";
import { redirect } from "next/navigation";
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
  await db.auth.signOut();
  redirect("/login");
}
export async function changePassword(form: FormData) {
  const { db } = await session();
  const password = String(form.get("password"));
  if (password.length < 12)
    jump("/history", "Use uma senha de pelo menos 12 caracteres.");
  const { error } = await db.auth.updateUser({ password });
  if (error) jump("/history", "Não foi possível atualizar a senha.");
  jump("/history", "Senha atualizada.", "success");
}
export async function createMeeting(form: FormData) {
  const { db, profile } = await session();
  if (profile.role !== "sdr")
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
  if (error) jump("/admin", error.message);
  revalidatePath("/", "layout");
  jump("/admin", "Alteração salva e auditada.", "success");
}
