/** Validates the existing connection without requiring another project or environment. */
export function verifySupabaseConfiguration(env: Record<string, string | undefined>) {
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let claims: { role?: string; ref?: string } | undefined;
  try {
    const part = publicKey?.split(".")[1];
    if (part) claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {}
  if (publicKey?.startsWith("sb_secret_") || claims?.role === "service_role") {
    throw new Error("Chave administrativa bloqueada em NEXT_PUBLIC_SUPABASE_ANON_KEY. Utilize somente uma chave pública anon/publishable.");
  }
  const remote = env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production";
  const address = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!remote && !address && !publicKey) return;
  let target: URL | undefined;
  try {
    target = new URL(address ?? "");
  } catch {}
  if (
    !target || !publicKey ||
    !(target.protocol === "https:" || !remote && target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) ||
    target.username || target.password || (remote && target.port) ||
    target.pathname !== "/" || target.search || target.hash ||
    (remote && !(publicKey.startsWith("sb_publishable_") || claims?.role === "anon")) ||
    (claims?.ref && target.hostname.endsWith(".supabase.co") && target.hostname !== `${claims.ref}.supabase.co`)
  ) {
    throw new Error(
      "Configuração Supabase inválida: use a URL e a chave pública anon/publishable do projeto atual, sem credenciais na URL. A URL e o ref de uma chave JWT devem corresponder.",
    );
  }
}
