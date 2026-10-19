import { cache } from "react";
import type { Access } from "./access";
import { redirect } from "next/navigation";
import { configured, supabase } from "./supabase";
export const session = cache(async function session() {
  if (!configured()) redirect("/login");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error || !profile?.active)
    redirect(
      "/login?error=" +
        encodeURIComponent("Conta sem perfil ativo. Contate o administrador."),
    );
  const { data: access, error: accessError } = await db.rpc("current_access");
  if (accessError || !access || !Array.isArray(access.functions))
    throw new Error(
      "Não foi possível carregar as permissões. Verifique a migration 003 e a conexão.",
    );
  return {
    db,
    user,
    profile: { ...profile, ...access } as Access & {
      id: string;
      name: string;
      active: boolean;
    },
  };
});
export function check(error: { message: string } | null) {
  if (error)
    throw new Error(
      "Não foi possível consultar os dados. Verifique a configuração do Supabase.",
    );
}
