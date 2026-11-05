import "server-only";
import { createClient } from "@supabase/supabase-js";
export function authAdministrator() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
}
export async function processRemovalQueue(limit = 5) {
  const started = Date.now();
  const db = authAdministrator();
  if (!db) throw new Error("administrative_removal_service_unavailable");
  const rows = await db
    .from("user_lifecycle_operations")
    .select("id,target_id")
    .eq("mode", "remove")
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);
  if (rows.error) throw new Error("administrative_removal_queue_unavailable");
  let processed = 0,
    pending = 0;
  for (const op of rows.data ?? []) {
    if (Date.now() - started > 15000) break;
    try {
      const claimed = await db.rpc("resume_simple_removal", {
        operation_id: op.id,
      });
      if (claimed.error || !claimed.data) continue;
      await db.auth.admin.deleteUser(op.target_id, false);
      const current = await db
        .from("user_lifecycle_operations")
        .select("status")
        .eq("id", op.id)
        .single();
      if (current.data?.status === "completed") processed++;
      else pending++;
    } catch {
      pending++;
    }
  }
  return { processed, pending };
}
