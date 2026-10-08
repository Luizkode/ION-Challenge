"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
export function Live() {
  const router = useRouter();
  useEffect(() => {
    const db = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    const channel = db
      .channel("campaign-updates")
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
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      void db.removeChannel(channel);
    };
  }, [router]);
  return (
    <span className="live">
      <i />
      Ao vivo · reconexão automática
    </span>
  );
}
