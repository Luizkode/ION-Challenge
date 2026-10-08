import { createClient } from "@supabase/supabase-js";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_PASSWORD",
];
if (required.some((k) => !process.env[k]))
  throw new Error(
    "Defina as variáveis do bootstrap em um ambiente autorizado, sem compartilhá-las.",
  );
if (process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 12)
  throw new Error("Use uma senha de pelo menos 12 caracteres.");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { count, error: check } = await db
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin");
if (check) throw new Error("Aplique a migration antes do bootstrap.");
if (count)
  throw new Error("Já existe administrador. Utilize o painel autenticado.");
const { data, error } = await db.auth.admin.createUser({
  email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  email_confirm: true,
});
if (error)
  throw new Error(
    "Não foi possível criar o usuário. Verifique se já existe em Authentication.",
  );
const { error: profile } = await db
  .from("profiles")
  .insert({ id: data.user.id, name: "Administrador ION", role: "admin" });
if (profile) {
  await db.auth.admin.deleteUser(data.user.id);
  throw new Error("Falha ao cadastrar perfil; usuário criado foi removido.");
}
console.log(
  "Administrador inicial criado. Altere a senha no primeiro acesso e remova as variáveis do bootstrap.",
);
