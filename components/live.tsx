"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
export function Live() {
  const router = useRouter(),
    path = usePathname();
  const challenger = [
    "/challenger",
    "/meetings",
    "/validation",
    "/admin",
    "/history",
  ].some((p) => path === p || path.startsWith(p + "/"));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (
        document.visibilityState !== "visible" ||
        document.querySelector('[data-form-dirty="true"]')
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    const db = challenger
      ? createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )
      : null;
    const channel = db
      ?.channel("campaign-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_updates" },
        refresh,
      )
      .subscribe();
    const interval = challenger ? setInterval(refresh, 15000) : undefined;
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", refresh);
      if (db && channel) void db.removeChannel(channel);
    };
  }, [router, challenger]);
  return (
    <span className="live">
      <i />
      {challenger ? "Atualização automática" : "ION OS · operação integrada"}
    </span>
  );
}
