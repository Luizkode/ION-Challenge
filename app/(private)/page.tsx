import { AnalyticsOverview } from "@/components/analytics-overview";
import { FinanceOverview } from "@/components/finance-overview";
import { OperationsOverview } from "@/components/operations-overview";
import { redirect } from "next/navigation";
import { commercialAccess, functionLabels } from "@/lib/access";
import Link from "next/link";
import { CommercialChart } from "@/components/commercial-chart";
import { session, check } from "@/lib/session";
import { Empty, Field, Notice } from "@/components/ui";
import { dashboardPeriod, commercialSummary } from "@/lib/os-dashboard";
import { osModules, canAccessModule } from "@/lib/os-modules";
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; error?: string }>;
}) {
  const { db, profile } = await session();
  if (profile.category === "partner") redirect("/partners");
  if (!commercialAccess(profile)) {
    const { data: companies, error } = await db
      .from("access_companies")
      .select("id,name");
    check(error);
    return (
      <>
        <div className="page-title">
          <div>
            <p className="eyebrow">ION OS · MINHA ÁREA</p>
            <h1>Seu dashboard</h1>
            <p className="muted">
              {profile.functions.map((f) => functionLabels[f]).join(" · ")}
            </p>
          </div>
        </div>
        <OperationsOverview />
        <FinanceOverview />
        <AnalyticsOverview />
        <section className="panel">
          <div className="panel-title">
            <h2>Clientes atribuídos</h2>
          </div>
          {companies?.length ? (
            companies.map((c) => (
              <div className="team-row" key={c.id}>
                {c.name}
              </div>
            ))
          ) : (
            <Empty>
              Nenhuma empresa atribuída. Peça ao administrador para vincular seu
              acesso aos clientes e serviços sob sua responsabilidade.
            </Empty>
          )}
        </section>
      </>
    );
  }
  const params = await searchParams;
  const period = dashboardPeriod(params);
  const { data: meetings, error } = await db
    .from("meetings")
    .select("id,status,opportunity_id,scheduled_at")
    .gte("scheduled_at", period.start)
    .lt("scheduled_at", period.end);
  check(error);
  let contracts: { opportunity_id: string }[] | undefined;
  let activePeople: number | undefined;
  if (profile.role === "admin") {
    const [c, p] = await Promise.all([
      db
        .from("contracts")
        .select("id,opportunity_id")
        .eq("active", true)
        .gte("closed_at", period.from)
        .lte("closed_at", period.to),
      db.from("profiles").select("id").eq("active", true),
    ]);
    check(c.error);
    check(p.error);
    contracts = c.data ?? [];
    activePeople = p.data?.length ?? 0;
  }
  const summary = commercialSummary(meetings ?? [], contracts);
  const crm = await db.rpc("crm_report", {
    filters: { from: period.start, to: period.end },
  });
  check(crm.error);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · AGENCY OPERATING SYSTEM</p>
          <h1>
            {profile.role === "admin"
              ? "Visão geral da agência"
              : "Sua operação, em um só lugar."}
          </h1>
          <p className="muted">
            Olá, {profile.name.split(" ")[0]}.{" "}
            {profile.role === "admin"
              ? "Acompanhe os registros reais da operação e acesse os módulos da ION."
              : "Acompanhe os registros autorizados para sua função."}
          </p>
        </div>
        <span className="badge">ION OS · Acesso por função</span>
      </div>
      <Notice params={{ error: period.error ?? params.error }} />
      <section className="panel">
        <form className="filters" method="get">
          <Field
            label="Início do período"
            name="from"
            type="date"
            value={period.from}
          />
          <Field
            label="Fim do período"
            name="to"
            type="date"
            value={period.to}
          />
          <button className="button">Aplicar período</button>
        </form>
        <p className="table-note">
          Reuniões pelo dia agendado; contratos confirmados pela data de
          fechamento. Horário de Brasília.{" "}
          {profile.role !== "admin"
            ? "Dados limitados ao seu acesso pelo banco."
            : "Visão de todos os registros autorizados."}
        </p>
      </section>
      <div className="stats">
        {[
          ["Reuniões agendadas", summary.scheduled],
          ["Reuniões realizadas", summary.held],
          ["Contratos confirmados", summary.contracts ?? "Restrito"],
          [
            "Conversão no período",
            summary.conversion === undefined
              ? "—"
              : summary.conversion.toFixed(1) + "%",
          ],
          ...(activePeople === undefined
            ? []
            : [["Colaboradores ativos", activePeople]]),
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="muted small">
        Conversão: oportunidades com reunião realizada e contrato confirmado no
        período, divididas pelas oportunidades com reunião realizada no período.
        Reuniões repetidas não duplicam essa taxa.
      </p>
      {!meetings?.length && (
        <section className="panel">
          <Empty>
            Nenhuma reunião registrada no período para o seu acesso. Os
            indicadores serão atualizados a partir dos registros reais.
          </Empty>
        </section>
      )}
      <section className="panel">
        <div className="panel-title">
          <h2>CRM Comercial</h2>
          <Link className="button" href="/crm">
            Abrir CRM
          </Link>
        </div>
        <div className="stats padded">
          {[
            ["Leads cadastrados", crm.data?.leads ?? 0],
            ["Contatos realizados", crm.data?.contacts ?? 0],
            ["Fechamentos comerciais", crm.data?.won ?? 0],
          ].map(([label, value]) => (
            <div className="stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <p className="table-note">
          Dados do CRM no período selecionado, limitados ao seu acesso.
          Fechamentos comerciais aguardam confirmação administrativa para
          pontuar.
        </p>
      </section>
      <OperationsOverview />
      <FinanceOverview />
      <AnalyticsOverview />
      <CommercialChart
        scheduled={summary.scheduled}
        held={summary.held}
        contracts={summary.contracts}
      />
      <section className="panel">
        <div className="panel-title">
          <h2>Módulos da plataforma</h2>
          <span className="small muted">Evolução incremental</span>
        </div>
        {osModules
          .filter((m) => m.id !== "dashboard" && canAccessModule(m.id, profile))
          .map((m) => (
            <div className="team-row" key={m.id}>
              <div>
                <strong>{m.name}</strong>
                <small>{m.description}</small>
              </div>
              <Link
                className="button"
                href={m.path}
                aria-label={"Acessar " + m.name}
              >
                Acessar
              </Link>
            </div>
          ))}
      </section>
      {profile.role === "admin" && (
        <section className="panel">
          <div className="panel-title">
            <h2>Leitura dos indicadores</h2>
            <span className="badge">Dados reais</span>
          </div>
          <Empty>
            Contratos comerciais não equivalem a dinheiro recebido. O Financeiro
            considera liquidações e estornos; o Analytics mostra resultados dos
            anunciantes. A pontuação permanece sujeita à validação e às regras
            do Challenger.
          </Empty>
        </section>
      )}
    </>
  );
}
