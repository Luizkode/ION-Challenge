"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { configured, supabase } from "@/lib/supabase";
import { session } from "@/lib/session";
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
const meetingSchema = z.object({
  campaign_id: z.string().uuid(),
  company: z.string().trim().min(2).max(150),
  contact: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().min(10).max(15)),
  city: z.string().trim().min(2).max(100),
  niche: z.string().trim().min(2).max(100),
  closer_id: z.string().uuid(),
  scheduled_at: z.string().min(1),
  notes: z.string().max(2000),
  opportunity_id: z.string().optional(),
});
export async function createMeeting(form: FormData) {
  const { db } = await session();
  const result = meetingSchema.safeParse(Object.fromEntries(form));
  if (!result.success) jump("/meetings", "Revise os campos da reunião.");
  const data = {
    ...result.data,
    scheduled_at: new Date(result.data.scheduled_at).toISOString(),
  };
  const { error } = await db.rpc("create_meeting", { data });
  if (error) jump("/meetings", error.message);
  revalidatePath("/", "layout");
  jump("/meetings", "Reunião cadastrada. Ainda não gera pontos.", "success");
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
