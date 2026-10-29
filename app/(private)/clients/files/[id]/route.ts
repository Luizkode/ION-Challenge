import { session } from "@/lib/session";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await session();
  const { id } = await params;
  if (!z.string().guid().safeParse(id).success)
    return new Response("Documento indisponível", { status: 404 });
  const r = await db.rpc("ops_download", { fid: id });
  if (r.error)
    return new Response("Documento indisponível", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const file = await db.storage.from("ion-os-documents").download(r.data.path);
  if (file.error || !file.data)
    return new Response("Documento indisponível", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  return new Response(file.data.stream(), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename=\"documento\"; filename*=UTF-8''" +
        encodeURIComponent(r.data.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
