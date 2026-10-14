import type { NextConfig } from "next";
// Only Vercel Preview builds require an explicitly selected staging database.
// Production and local development retain their current behavior.
export function verifyPreviewDatabase(env: Record<string, string | undefined>) {
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
    target.username ||
    target.password ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    throw new Error(
      "Preview bloqueado: configure ION_OS_PREVIEW_SUPABASE_PROJECT_REF com o identificador de um projeto Supabase de homologação separado e use a URL e a chave pública desse mesmo projeto nas variáveis do ambiente Preview da Vercel. Não utilize o projeto de produção.",
    );
  }
}
verifyPreviewDatabase(process.env);

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
