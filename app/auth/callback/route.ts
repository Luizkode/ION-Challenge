import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const db = await supabase();
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  let ok = false;
  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (token_hash && (type === "invite" || type === "recovery")) {
    const { error } = await db.auth.verifyOtp({ token_hash, type });
    ok = !error;
  }
  const response = NextResponse.redirect(
    new URL(
      ok ? "/history" : "/login?error=Link+inválido+ou+expirado",
      url.origin,
    ),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
