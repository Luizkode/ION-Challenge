import { redirect } from "next/navigation";
import { configured, supabase } from "./supabase";
export async function session() {
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
  return {
    db,
    user,
    profile: profile as {
      id: string;
      name: string;
      role: "sdr" | "closer" | "admin";
      active: boolean;
    },
  };
}
export function check(error: { message: string } | null) {
  if (error)
    throw new Error(
      "Não foi possível consultar os dados. Verifique a configuração do Supabase.",
    );
}
