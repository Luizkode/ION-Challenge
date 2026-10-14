/** Fails closed before any Preview connection. Project ref is public configuration. */
export function verifyPreviewDatabase(env: Record<string, string | undefined>) {
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let claims: { role?: string; ref?: string } | undefined;
  try {
    const part = publicKey?.split(".")[1];
    if (part) claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {}
  if (publicKey?.startsWith("sb_secret_") || claims?.role === "service_role") {
    throw new Error("Chave administrativa bloqueada em NEXT_PUBLIC_SUPABASE_ANON_KEY. Utilize somente uma chave pública anon/publishable.");
  }
  if (env.VERCEL_ENV !== "preview") return;
  const ref = env.ION_OS_PREVIEW_SUPABASE_PROJECT_REF;
  let target: URL | undefined;
  try {
    target = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  } catch {}
  if (
    !ref ||
    !/^[a-z0-9]+$/.test(ref) ||
    target?.protocol !== "https:" ||
    target.hostname !== `${ref}.supabase.co` ||
    target.port || target.username || target.password ||
    target.pathname !== "/" || target.search || target.hash ||
    !(publicKey?.startsWith("sb_publishable_") || claims?.role === "anon" && claims.ref === ref)
  ) {
    throw new Error(
      "Preview bloqueado: configure ION_OS_PREVIEW_SUPABASE_PROJECT_REF com o projeto separado de homologação e NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY desse mesmo projeto. Não utilize produção.",
    );
  }
}
