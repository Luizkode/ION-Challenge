import { hasFunction } from "@/lib/access";
import { redirect } from "next/navigation";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { CrmLeadForm } from "@/components/crm-lead-form";
import { Notice } from "@/components/ui";
export default async function NewLead({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { db, profile } = await crmContext();
  if (profile.category !== "admin" && !hasFunction(profile, "sdr"))
    redirect("/crm");
  const people = await crmDirectory(db);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · CRM COMERCIAL</p>
          <h1>Novo lead</h1>
        </div>
      </div>
      <Notice params={await searchParams} />
      <section className="panel padded">
        <CrmLeadForm
          people={people}
          admin={profile.category === "admin"}
          userId={profile.id}
        />
      </section>
    </>
  );
}
