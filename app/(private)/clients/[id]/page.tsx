import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { operationsContext } from "@/lib/operations-server";
import { check } from "@/lib/session";
import {
  relationships,
  contractStatuses,
  serviceStatuses,
  periods,
  overdue,
  type Client,
  type Contract,
  type Service,
  type Update,
  type OperationalFile,
  type Person,
  type Catalog,
} from "@/lib/operations";
import {
  ClientForm,
  ContractForm,
  ServiceForm,
  ProgressForm,
  Published,
} from "@/components/operations-forms";
import { FileUpload, FileDownload } from "@/components/operations-files";
import { Notice, Empty, Select, Field } from "@/components/ui";
import { Submit } from "@/components/submit";
import {
  publishUpdate,
  manageFile,
  reconcileSource,
} from "@/app/operations-actions";
export default async function ClientDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db, profile } = await operationsContext();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const admin = profile.category === "admin";
  const [
    client,
    contracts,
    services,
    updates,
    files,
    catalog,
    people,
    notes,
    assignments,
    serviceAssignments,
    alerts,
  ] = await Promise.all([
    db
      .from("ops_clients")
      .select("*,access_companies(name,active)")
      .eq("company_id", id)
      .maybeSingle(),
    db
      .from("ops_contracts")
      .select("*")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("ops_services")
      .select("*,ops_catalog(name)")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("ops_updates")
      .select("*")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("ops_files")
      .select("*")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("ops_catalog").select("*").order("name"),
    admin ? db.rpc("ops_directory") : db.rpc("ops_people", { cid: id }),
    admin
      ? db
          .from("ops_admin_notes")
          .select("notes")
          .eq("company_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("client_assignments").select("profile_id").eq("company_id", id),
    db.from("ops_service_assignments").select("service_id,profile_id"),
    admin
      ? db.rpc("ops_source_alerts")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [
    client,
    contracts,
    services,
    updates,
    files,
    catalog,
    people,
    notes,
    assignments,
    serviceAssignments,
    alerts,
  ])
    check(r.error);
  if (!client.data) notFound();
  const c = client.data as Client;
  const cs = (contracts.data ?? []) as Contract[];
  const ss = (services.data ?? []) as Service[];
  const us = (updates.data ?? []) as Update[];
  const fs = (files.data ?? []) as OperationalFile[];
  const staff = (people.data ?? []) as Person[];
  const cats = (catalog.data ?? []) as Catalog[];
  function Documents({
    serviceId,
    contractId,
  }: {
    serviceId?: string;
    contractId?: string;
  }) {
    const list = fs.filter((f) =>
      serviceId
        ? f.service_id === serviceId
        : contractId
          ? f.contract_id === contractId
          : !f.service_id && !f.contract_id,
    );
    return (
      <>
        <FileUpload
          companyId={id}
          serviceId={serviceId}
          contractId={contractId}
        />
        {list
          .filter((f) => f.state !== "pending")
          .map((f) => (
            <div className="padded" key={f.id}>
              <p>
                <strong>{f.name}</strong> ·{" "}
                {f.mime === "application/pdf"
                  ? "PDF"
                  : f.mime.startsWith("image/")
                    ? "Imagem"
                    : f.mime === "text/plain"
                      ? "Texto"
                      : f.mime.includes("wordprocessing")
                        ? "DOCX"
                        : "XLSX"}{" "}
                · {(f.size / 1024).toFixed(1)} KB ·{" "}
                {new Date(f.created_at).toLocaleDateString("pt-BR")} · Enviado
                por{" "}
                {staff.find((p) => p.id === f.uploaded_by)?.name ??
                  (f.uploaded_by === profile.id
                    ? profile.name
                    : "Equipe ION")}{" "}
                ·{" "}
                {f.state === "archived"
                  ? "Arquivado"
                  : f.partner_visible
                    ? "Autorizado para parceiro"
                    : "Interno"}
              </p>
              {f.state === "ready" && <FileDownload id={f.id} name={f.name} />}{" "}
              {admin && (
                <form action={manageFile} className="form-grid">
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="company_id" value={id} />
                  <Select
                    name="state"
                    label="Estado do documento"
                    value={f.state}
                  >
                    <option value="ready">Disponível</option>
                    <option value="archived">
                      Arquivado (preservar arquivo)
                    </option>
                  </Select>
                  <Published
                    label="Autorizar documento para parceiro"
                    value={f.partner_visible}
                  />
                  <Submit>Atualizar documento</Submit>
                </form>
              )}
            </div>
          ))}
      </>
    );
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · CLIENTES E SERVIÇOS</p>
          <h1>{c.access_companies.name}</h1>
          <p className="muted">
            {c.contact} · {c.phone} · {c.email}
          </p>
        </div>
        <Link className="button" href="/clients">
          Voltar aos clientes
        </Link>
      </div>
      <Notice params={await searchParams} />
      <p>
        <span className="badge">{relationships[c.relationship]}</span> ·
        Entrada: {c.joined_at} · {c.city} / {c.state} · {c.niche}
      </p>
      <p className="muted small">
        Instagram: {c.instagram || "Não informado"} · Site:{" "}
        {c.website || "Não informado"}
      </p>
      {admin && (
        <section className="panel padded">
          <details>
            <summary>Editar cliente e responsáveis</summary>
            <ClientForm
              client={c}
              people={staff}
              notes={notes.data?.notes ?? ""}
              selected={assignments.data?.map((x) => x.profile_id)}
            />
          </details>
        </section>
      )}
      {admin &&
        (alerts.data ?? [])
          .filter((a: { company_id: string }) => a.company_id === id)
          .map((a: { id: string; reference: string; source_state: string }) => (
            <section className="panel padded" key={a.id}>
              <h2>Revisar origem: {a.reference}</h2>
              <p className="notice error">
                O fechamento comercial foi cancelado ou perdeu a validação. Nada
                foi excluído da operação.
              </p>
              <form action={reconcileSource} className="form-grid">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="company_id" value={id} />
                <Select name="decision" label="Decisão operacional">
                  <option value="keep">Manter operação</option>
                  <option value="paused">Pausar contrato operacional</option>
                  <option value="cancelled">
                    Cancelar contrato operacional
                  </option>
                </Select>
                <Field
                  label="Justificativa (mín. 8 caracteres)"
                  name="reason"
                />
                <label className="confirm-line">
                  <input type="checkbox" name="confirm" value="true" required />
                  Confirmo a decisão e a preservação do histórico
                </label>
                <Submit>Registrar revisão</Submit>
              </form>
            </section>
          ))}
      <section className="panel">
        <div className="panel-title">
          <h2>Contratos e aditivos</h2>
        </div>
        {cs.length ? (
          cs.map((x) => (
            <article className="padded" key={x.id}>
              <h3>
                {x.reference} · {contractStatuses[x.status]}
              </h3>
              <p>
                {Number(x.amount).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}{" "}
                · {periods[x.periodicity]} · {x.starts_at} a{" "}
                {x.ends_at || "prazo indeterminado"}
              </p>
              <p>
                {x.services_text} · Prazo mínimo: {x.min_months} meses
                {x.parent_id ? " · Aditivo de contrato anterior" : ""}
              </p>
              {x.source_deal_id && (
                <p className="small muted">
                  Originado de contrato comercial confirmado. Histórico do CRM
                  preservado.
                </p>
              )}
              {admin && (
                <details>
                  <summary>Editar contrato</summary>
                  <ContractForm
                    companyId={id}
                    contract={x}
                    contracts={cs}
                    people={staff}
                  />
                </details>
              )}
              <details>
                <summary>Documentos do contrato</summary>
                <Documents contractId={x.id} />
              </details>
            </article>
          ))
        ) : (
          <Empty>
            {admin
              ? "Nenhum contrato cadastrado."
              : "Detalhes contratuais restritos ao responsável interno e ADM."}
          </Empty>
        )}
        {admin && (
          <details className="padded">
            <summary>Novo contrato ou aditivo</summary>
            <ContractForm companyId={id} contracts={cs} people={staff} />
          </details>
        )}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Serviços contratados</h2>
          <span className="small muted">Apenas serviços autorizados</span>
        </div>
        {ss.length ? (
          ss.map((s) => (
            <article className="padded" key={s.id}>
              <h3>
                {s.ops_catalog.name} · {serviceStatuses[s.status]}
              </h3>
              <p>{s.description}</p>
              <p className="small muted">
                Responsáveis:{" "}
                {serviceAssignments.data
                  ?.filter((a) => a.service_id === s.id)
                  .map(
                    (a) =>
                      staff.find((p) => p.id === a.profile_id)?.name ??
                      "Colaborador atribuído",
                  )
                  .join(", ") || "Nenhum responsável atribuído"}
              </p>
              <p className="small muted">
                Início: {s.starts_at} · Prazo: {s.due_at || "Não definido"} ·
                Entrega: {s.delivered_at || "Pendente"}
              </p>
              {overdue(s) && <p className="notice error">Prazo vencido</p>}
              <details>
                <summary>Atualizar andamento · {s.ops_catalog.name}</summary>
                <ProgressForm service={s} admin={admin} />
              </details>
              {admin && (
                <details>
                  <summary>Editar serviço e atribuições</summary>
                  <ServiceForm
                    companyId={id}
                    service={s}
                    contracts={cs}
                    catalog={cats}
                    people={staff}
                    selected={serviceAssignments.data
                      ?.filter((a) => a.service_id === s.id)
                      .map((a) => a.profile_id)}
                  />
                </details>
              )}
              <details>
                <summary>Arquivos do serviço · {s.ops_catalog.name}</summary>
                <Documents serviceId={s.id} />
              </details>
            </article>
          ))
        ) : (
          <Empty>Nenhum serviço atribuído para seu acesso.</Empty>
        )}
        {admin && (
          <details className="padded">
            <summary>Novo serviço contratado</summary>
            {cs.length ? (
              <ServiceForm
                companyId={id}
                contracts={cs}
                catalog={cats}
                people={staff}
              />
            ) : (
              <p>Cadastre um contrato antes de adicionar serviços.</p>
            )}
          </details>
        )}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Documentos do cliente</h2>
        </div>
        <Documents />
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Histórico operacional</h2>
          <span className="small muted">Últimos 200 registros autorizados</span>
        </div>
        {us.length ? (
          us.map((u) => (
            <article className="padded" key={u.id}>
              <p>{u.body}</p>
              <p className="small muted">
                {new Date(u.created_at).toLocaleString("pt-BR")} ·{" "}
                {staff.find((p) => p.id === u.actor_id)?.name ??
                  (u.actor_id === profile.id
                    ? profile.name
                    : "Equipe ION")}{" "}
                · {u.published ? "Resumo publicado" : "Informação interna"}
              </p>
              {admin && (
                <details>
                  <summary>Publicação autorizada do resumo</summary>
                  <form action={publishUpdate} className="form-grid">
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="company_id" value={id} />
                    <label className="field">
                      <span>Texto público autorizado</span>
                      <textarea
                        name="partner_body"
                        maxLength={4000}
                        defaultValue={u.partner_body}
                      />
                    </label>
                    <label className="confirm-line">
                      <input
                        type="checkbox"
                        name="published"
                        value="true"
                        defaultChecked={u.published}
                      />
                      Publicar no portal de consulta
                    </label>
                    <Submit>Atualizar publicação</Submit>
                  </form>
                </details>
              )}
            </article>
          ))
        ) : (
          <Empty>Nenhuma atualização autorizada.</Empty>
        )}
      </section>
    </>
  );
}
