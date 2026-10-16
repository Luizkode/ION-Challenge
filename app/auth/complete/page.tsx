"use client";
import { useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function CompleteAuthentication() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");
    // Remove credentials from the address/history before doing further work.
    window.history.replaceState(null, "", window.location.pathname);
    const fail = () => window.location.replace("/login?error=Link+inválido+ou+expirado");
    if (!access || !refresh) { fail(); return; }
    const db = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    db.auth.setSession({ access_token: access, refresh_token: refresh })
      .then(({ error }) => { if (error) fail(); else window.location.replace("/account"); })
      .catch(fail);
  }, []);
  return (
    <main className="login">
      <section className="login-form">
        <div className="wordmark">ION<span> / OS</span></div>
        <h2>Concluindo seu acesso…</h2>
        <p className="muted" role="status">Aguarde a confirmação da sua sessão.</p>
      </section>
    </main>
  );
}
