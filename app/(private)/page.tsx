import { session, check } from "@/lib/session";
import { Empty, labels } from "@/components/ui";
import {
  Target,
  LockKeyhole,
  Trophy,
  ArrowUpRight,
  CalendarDays,
} from "lucide-react";
import type { Board } from "@/lib/types";
export default async function Dashboard() {
  const { db, profile } = await session();
  const { data: campaigns, error } = await db
    .from("campaigns")
    .select("*")
    .order("starts_at", { ascending: false, nullsFirst: true });
  check(error);
  const ca = campaigns?.find((c) => c.state !== "finalized") ?? campaigns?.[0];
  if (!ca) return <Empty>Nenhuma campanha configurada.</Empty>;
  const { data, error: rpcError } = await db.rpc("dashboard", {
    p_campaign: ca.id,
  });
  check(rpcError);
  const b = data as Board;
  const percent = Math.min(100, (b.held / ca.goal) * 100);
  const unlocked = b.held >= ca.goal;
  const me = b.individual.find((r) => r.id === profile.id);
  const days = ca.ends_at
    ? Math.max(
        0,
        Math.ceil((new Date(ca.ends_at).getTime() - Date.now()) / 86400000),
      )
    : null;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">A CORRIDA PELO IPHONE 13</p>
          <h1>Uma equipe. Um objetivo.</h1>
          <p className="muted">
            Olá, {profile.name.split(" ")[0]}. Sua próxima conquista começa
            aqui.
          </p>
        </div>
        <span className="badge">
          <i />
          {ca.state === "active" && days === 0
            ? "Período encerrado · aguardando conferência"
            : labels[ca.state]}
        </span>
      </div>
      <section className="hero">
        <div className="progress-section">
          <p className="eyebrow">
            <Target size={16} />
            META COLETIVA
          </p>
          <div className="goal">
            <strong>{b.held}</strong>
            <span>/ {ca.goal} reuniões</span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Meta coletiva"
            aria-valuenow={b.held}
            aria-valuemax={ca.goal}
          >
            <div style={{ width: percent + "%" }} />
          </div>
          <div className="progress-caption">
            <span>{percent.toFixed(1)}% concluído</span>
            <span>Faltam {Math.max(0, ca.goal - b.held)} reuniões</span>
          </div>
          <p className="muted small">
            Somente oportunidades realizadas e validadas contam para a meta.
          </p>
        </div>
        <div className="prize">
          <div className="prize-icon">
            {unlocked ? <Trophy size={36} /> : <LockKeyhole size={36} />}
          </div>
          <p className="eyebrow">
            {unlocked ? "META ATINGIDA" : "PRÊMIO BLOQUEADO"}
          </p>
          <h2>{ca.prize}</h2>
          <p className="muted">
            {ca.state === "finalized"
              ? ca.winner_id
                ? "Vencedor definido após conferência administrativa."
                : "Campanha encerrada sem atingir a meta."
              : unlocked
                ? "Prêmio desbloqueado. A disputa continua até o encerramento."
                : "Uma conquista individual construída por todos."}
          </p>
        </div>
      </section>
      <div className="stats">
        {[
          ["Realizadas", b.held],
          ["Bem qualificadas", b.qualified],
          ["Contratos fechados", b.contracts],
          ["SDRs ativos", b.active_sdrs],
          ["Dias restantes", days ?? "—"],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {me && (
        <section className="personal">
          <div>
            <p className="eyebrow">SUA PERFORMANCE</p>
            <h3>{me.team}</h3>
          </div>
          <div>
            <strong>{me.points}</strong>
            <span>pontos</span>
          </div>
          <div>
            <strong>#{me.position}</strong>
            <span>posição</span>
          </div>
          <div>
            <strong>{me.held}</strong>
            <span>realizadas</span>
          </div>
          <ArrowUpRight className="purple" />
        </section>
      )}
      <div className="rank-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>Ranking individual</h2>
            <span className="muted small">
              {b.individual.length} participantes
            </span>
          </div>
          {b.individual.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Participante</th>
                    <th>Real.</th>
                    <th>Qual.</th>
                    <th>Contr.</th>
                    <th>Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {b.individual.map((r) => (
                    <tr
                      className={r.id === profile.id ? "mine" : ""}
                      key={r.id}
                    >
                      <td className={r.position <= 3 ? "purple" : ""}>
                        {String(r.position).padStart(2, "0")}
                      </td>
                      <td>
                        <strong>
                          {r.name}
                          {r.id === profile.id ? " · Você" : ""}
                        </strong>
                        <small>
                          {r.team}
                          {!r.active ? " · Inativo" : ""}
                          {b.individual.filter((x) => x.position === r.position)
                            .length > 1
                            ? " · Empate administrativo"
                            : ""}
                        </small>
                      </td>
                      <td>{r.held}</td>
                      <td>{r.qualified}</td>
                      <td>{r.contracts}</td>
                      <td className="score">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              Os participantes aparecerão após o vínculo à campanha.
            </Empty>
          )}
          <p className="table-note">
            Desempate: contratos → qualificadas → realizadas. Empates finais
            exigem conferência.
          </p>
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Ranking de equipes</h2>
            <Trophy size={18} className="muted" />
          </div>
          {b.teams.length ? (
            b.teams.map((t, i) => (
              <div className="team-row" key={t.id}>
                <span className="muted">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{t.name}</strong>
                  <small>
                    {t.participants}/5 integrantes · {t.held} realizadas
                  </small>
                </div>
                <strong>
                  {t.points}
                  <small>pontos</small>
                </strong>
              </div>
            ))
          ) : (
            <Empty>Crie os times e vincule os SDRs para começar.</Empty>
          )}
          <p className="table-note">
            O prêmio é definido pelo ranking individual.
          </p>
        </section>
      </div>
      <p className="muted small">
        <CalendarDays size={14} />{" "}
        {ca.starts_at
          ? `${new Date(ca.starts_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} a ${new Date(ca.ends_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "Data de início aguardando configuração administrativa."}
      </p>
    </>
  );
}
