import { timingSafeEqual } from "node:crypto";
import { processRemovalQueue } from "@/lib/admin-auth";
export const maxDuration = 60;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization") ?? "";
  const correct = expected ? "Bearer " + expected : "";
  if (
    !expected ||
    Buffer.byteLength(provided) !== Buffer.byteLength(correct) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(correct))
  )
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  try {
    return Response.json(await processRemovalQueue(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Serviço temporariamente indisponível" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
