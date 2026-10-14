import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { verifyPreviewDatabase } from "./preview-database";
export function configured() {
  verifyPreviewDatabase(process.env);
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
export async function supabase() {
  verifyPreviewDatabase(process.env);
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server Components are read-only; middleware refreshes sessions. */
          }
        },
      },
    },
  );
}
