import { redirect } from "next/navigation";
import { operationsAdmin } from "@/lib/operations-server";
import { check } from "@/lib/session";
import { ClientForm } from "@/components/operations-forms";
import { Notice } from "@/components/ui";
import { z } from "zod";
export default async function NewClient({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; error?: string }>;
}) {
  const { db } = await operationsAdmin();
  const p = await searchParams;
  const people = await db.rpc("ops_directory");
  check(people.error);
  const company = z.string().uuid().safeParse(p.company);
  const existing = company.success
    ? await db
        .from("access_companies")
        .select("id,name")
        .eq("id", company.data)
        .maybeSingle()
    : null;
  if (existing) check(existing.error);
  if (company.success) {
    const operational = await db
      .from("ops_clients")
      .select("company_id")
      .eq("company_id", company.data)
      .maybeSingle();
    check(operational.error);
    if (operational.data) redirect("/clients/" + company.data);
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · CLIENTES E SERVIÇOS</p>
          <h1>Novo cliente</h1>
        </div>
      </div>
      <Notice params={p} />
      <section className="panel padded">
        <ClientForm
          people={people.data ?? []}
          company={existing?.data ?? undefined}
        />
      </section>
    </>
  );
}
