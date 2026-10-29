"use server";

import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import {
  recoveryCallback,
  recoveryEmail,
  recoveryNotice,
} from "@/lib/auth-recovery";

/** Public Auth operation: anon key only, never the administrative client. */
export async function requestPasswordRecovery(form: FormData) {
  const email = recoveryEmail.safeParse(form.get("email"));
  if (!email.success)
    redirect(
      "/login?recovery=1&error=" +
        encodeURIComponent(
          "Informe um email válido para solicitar a recuperação.",
        ),
    );
  const callback = recoveryCallback(process.env);
  if (!configured() || !callback)
    redirect(
      "/login?recovery=1&error=" +
        encodeURIComponent(
          "A recuperação não está configurada. Contate o administrador.",
        ),
    );
  try {
    const db = await supabase();
    const { error } = await db.auth.resetPasswordForEmail(email.data, {
      redirectTo: callback,
    });
    if (error) {
      // Log only bounded operational metadata. Never include email, token, URL or provider body.
      console.warn("ion_os_recovery_request_failed", {
        status: error.status ?? 0,
      });
    }
  } catch {
    console.warn("ion_os_recovery_request_failed", { status: 0 });
  }
  // Same response for existing/unknown/inactive users and provider failures prevents enumeration.
  // Conditional wording deliberately does not claim email delivery.
  redirect("/login?recovery=1&success=" + encodeURIComponent(recoveryNotice));
}
