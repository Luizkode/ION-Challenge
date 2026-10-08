import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { adminOperation } from "@/app/actions";
import { Field, Select, Notice, Empty } from "@/components/ui";
import { Submit } from "@/components/submit";
const hidden = (operation: string) => (
  <input type="hidden" name="operation" value={operation} />
);
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db, profile } = await session();
  if (profile.role !== "admin") redirect("/");
  const results = await Promise.all([
    db.from("profiles").select("*").order("name"),
    db.from("teams").select("*").order("name"),
    db
      .from("campaigns")
      .select("*")
      .order("starts_at", { ascending: false, nullsFirst: true }),
    db
      .from("meetings")
      .select("*,opportunities(company,sdr_id)")
      .in("status", ["held", "qualified"]),
    db
      .from("contracts")
      .select("*,opportunities(company)")
      .order("closed_at", { ascending: false }),
    db
      .from("audit_logs")
      .select("*")
      .order("id", { ascending: false })
      .limit(100),
    db.from("campaign_participants").select("*,profiles(name),teams(name)"),
  ]);
  results.forEach((r) => check(r.error));
  const [pr, tr, cr, mr, contracts, audit, participants] = results;
  const profiles = pr.data ?? [],
    teams = tr.data ?? [],
    campaigns = cr.data ?? [],
    meetings = mr.data ?? [];
  const ca = campaigns.find((c) => c.state !== "finalized");
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">CONTROLE DA OPERAÇÃO</p>
          <h1>Administração</h1>
          <p className="muted">
            Regras, pessoas e resultados. Toda mudança relevante é auditada.
          </p>
        </div>
      </div>
      <Notice params={await searchParams} />
      <div className="stats">
        {[
          ["Colaboradores", profiles.length],
          ["Times", teams.length],
          ["Reuniões válidas", meetings.length],
          [
            "Contratos ativos",
            contracts.data?.filter((c) => c.active).length ?? 0,
          ],
        ].map(([k, v]) => (
          <div className="stat" key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <section className="panel padded">
        <h2>Campanha</h2>
        {ca ? (
          <>
            <form action={adminOperation} className="form-grid">
              {hidden("campaign")}
              <input type="hidden" name="id" value={ca.id} />
              <Field name="name" label="Nome" value={ca.name} />
              <Field name="prize" label="Prêmio" value={ca.prize} />
              <Field
                name="description"
                label="Descrição"
                value={ca.description}
                required={false}
              />
              <Field
                name="goal"
                label="Meta coletiva"
                type="number"
                min={1}
                value={ca.goal}
              />
              <Field
                name="duration"
                label="Duração (dias)"
                type="number"
                min={1}
                value={ca.duration}
              />
              <Field
                name="starts_at"
                label="Início oficial (horário local, só preencha quando definido)"
                type="datetime-local"
                required={false}
                value={ca.starts_at ?? ""}
              />
              <Field
                name="meeting_points"
                label="Pontos: realizada"
                type="number"
                min={0}
                value={ca.meeting_points}
              />
              <Field
                name="qualified_points"
                label="Pontos: qualificada"
                type="number"
                min={0}
                value={ca.qualified_points}
              />
              <Field
                name="contract_points"
                label="Pontos: contrato"
                type="number"
                min={0}
                value={ca.contract_points}
              />
              <Select label="Ativação" name="activate">
                <option value="false">Salvar configuração</option>
                <option value="true">
                  Ativar campanha na data configurada
                </option>
              </Select>
              <Field
                name="reason"
                label="Justificativa para alterações após ativação"
                required={ca.state !== "draft"}
              />
              <Select
                label="Confirmar impacto nas pontuações anteriores"
                name="confirm"
              >
                <option value="false">Não</option>
                <option value="true">Sim, conferi e autorizo</option>
              </Select>
              <Submit>Salvar campanha</Submit>
            </form>
            <details>
              <summary>Encerramento e conferência do vencedor</summary>
              <p className="muted small">
                Permitido somente após o período. Meta não alcançada encerra sem
                prêmio. Empate exige decisão justificada entre os líderes.
              </p>
              <form action={adminOperation} className="form-grid">
                {hidden("finalize")}
                <input type="hidden" name="id" value={ca.id} />
                <Select label="Vencedor conferido" name="winner_id">
                  <option value="">Sem vencedor (meta não atingida)</option>
                  {profiles
                    .filter((p) => p.role === "sdr")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
                <Field
                  name="reason"
                  label="Justificativa da conferência / desempate"
                />
                <Submit>Finalizar campanha</Submit>
              </form>
            </details>
          </>
        ) : (
          <form action={adminOperation} className="form-grid">
            {hidden("new_campaign")}
            <Field name="name" label="Nome da próxima campanha" />
            <Field name="prize" label="Prêmio" />
            <Submit>Criar campanha em configuração</Submit>
          </form>
        )}
      </section>
      <section className="panel padded">
        <h2>Colaboradores</h2>
        <p className="muted small">
          Crie primeiro o usuário em Supabase → Authentication → Users
          (convite). Cadastre abaixo o UUID para conceder o perfil. Não há
          cadastro público.
        </p>
        <form action={adminOperation} className="form-grid">
          {hidden("profile")}
          <Field name="id" label="UUID do usuário em Authentication" />
          <Field name="name" label="Nome" />
          <Select name="role" label="Perfil">
            <option value="sdr">SDR</option>
            <option value="closer">Closer</option>
            <option value="admin">Administrador</option>
          </Select>
          <Select name="active" label="Situação">
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>
          <Submit>Criar / atualizar colaborador</Submit>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Perfil</th>
                <th>Situação</th>
                <th>Identificador para edição</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.role}</td>
                  <td>{p.active ? "Ativo" : "Inativo"}</td>
                  <td className="small">{p.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel padded">
        <h2>Times e participantes</h2>
        <form action={adminOperation} className="form-grid">
          {hidden("team")}
          <Select label="Time" name="id">
            <option value="">Novo time</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Field label="Nome" name="name" />
          <Submit>Criar / renomear time</Submit>
        </form>
        {ca && (
          <form action={adminOperation} className="form-grid">
            {hidden("participant")}
            <input type="hidden" name="campaign_id" value={ca.id} />
            <Select label="SDR" name="profile_id">
              {profiles
                .filter((p) => p.role === "sdr" && p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
            <Select label="Time (máximo 5)" name="team_id">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select label="Ação" name="remove">
              <option value="false">Vincular / mover</option>
              <option value="true">Remover vínculo</option>
            </Select>
            <Submit>Atualizar vínculo</Submit>
          </form>
        )}
        <p className="muted small">
          O vínculo fica congelado após a primeira oportunidade, preservando o
          time da campanha.
        </p>
        {participants.data
          ?.filter((p) => p.campaign_id === ca?.id)
          .map((p) => (
            <p className="small" key={p.profile_id}>
              {p.profiles?.name} · {p.teams?.name}
            </p>
          ))}
      </section>
      <section className="panel padded">
        <h2>Contratos</h2>
        <form action={adminOperation} className="form-grid">
          {hidden("contract")}
          <Select label="Reunião válida vinculada" name="meeting_id">
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.opportunities.company} ·{" "}
                {new Date(m.scheduled_at).toLocaleDateString("pt-BR")}
              </option>
            ))}
          </Select>
          <Field label="Data de fechamento" name="closed_at" type="date" />
          <Field label="Valor em R$" name="amount" type="number" min={1} />
          <Field
            label="Referência do contrato / comprovante"
            name="reference"
          />
          <Field label="Observações" name="notes" required={false} />
          <Submit>Confirmar contrato</Submit>
        </form>
        <p className="small muted">
          O SDR é identificado pela oportunidade vinculada. O contrato substitui
          a pontuação por 7; não soma 11.
        </p>
        {contracts.data?.map((c) => (
          <details key={c.id}>
            <summary>
              {c.opportunities.company} ·{" "}
              {Number(c.amount).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}{" "}
              · {c.active ? "Confirmado" : "Anulado"}
            </summary>
            <p className="small">
              {c.reference} · {c.closed_at}
            </p>
            {c.active && (
              <form action={adminOperation} className="form-grid">
                {hidden("void_contract")}
                <input type="hidden" name="id" value={c.id} />
                <Field label="Justificativa para anulação" name="reason" />
                <Submit>Anular confirmação</Submit>
              </form>
            )}
          </details>
        ))}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Auditoria</h2>
          <span className="small muted">Últimas 100 ações</span>
        </div>
        {audit.data?.length ? (
          audit.data.map((a) => (
            <details className="audit" key={a.id}>
              <summary>
                {new Date(a.created_at).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}{" "}
                · {a.action} · {a.entity}
              </summary>
              <p className="small">
                Autor:{" "}
                {profiles.find((p) => p.id === a.actor_id)?.name ?? "Bootstrap"}{" "}
                · {a.reason ?? "Sem justificativa adicional"}
              </p>
              <pre>
                {JSON.stringify(
                  { antes: a.old_state, depois: a.new_state },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))
        ) : (
          <Empty>Nenhuma ação registrada.</Empty>
        )}
      </section>
    </>
  );
}
