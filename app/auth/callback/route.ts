import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.ION_OS_APP_URL || url.origin;
  const db = await supabase();
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  // Default Supabase email templates return tokens in the URL fragment.
  // Fragments are only available in the browser; HTTP redirects preserve them.
  if (!code && !token_hash) {
    const response = NextResponse.redirect(new URL("/auth/complete", origin));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
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
      ok ? "/account" : "/login?error=Link+inválido+ou+expirado",
      origin,
    ),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
