import { z } from "zod";

export const recoveryEmail = z
  .string()
  .trim()
  .email("Informe um email válido para solicitar a recuperação.");

// A public request must never reveal whether an email has an account or a send failed.
export const recoveryNotice =
  "Solicitação processada. Se este email tiver uma conta e o envio for autorizado, você receberá as instruções. Confira o spam; se não receber, contate o administrador.";

/** Only a trusted server setting may choose where authentication emails return. */
export function recoveryCallback(env: Record<string, string | undefined>) {
  const value =
    env.ION_OS_APP_URL ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
  if (!value) return null;
  try {
    const url = new URL(value);
    const remote = ["production", "preview"].includes(env.VERCEL_ENV ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !(
        url.protocol === "https:" ||
        (!remote && local && url.protocol === "http:")
      ) ||
      (remote && local)
    )
      return null;
    return new URL("/auth/callback", url).toString();
  } catch {
    return null;
  }
}
