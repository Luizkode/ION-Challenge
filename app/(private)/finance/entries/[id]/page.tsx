import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { financeAdmin } from "@/lib/finance-server";
import { check } from "@/lib/session";
import {
  brl,
  cents,
  statuses,
  type FinEntry,
  type Options,
} from "@/lib/finance";
import { EntryForm } from "@/components/finance-forms";
import { ConfirmedAdminForm } from "@/components/confirmed-admin-form";
import { Field, Notice, Empty } from "@/components/ui";
import { settle } from "@/app/finance-actions";
type Settlement = {
  id: string;
  amount: string;
  paid_at: string;
  method: string;
  notes: string;
  reversal_of: string | null;
  created_at: string;
};
export default async function Entry({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db } = await financeAdmin();
  const { id } = await params;
  if (!z.string().guid().safeParse(id).success) notFound();
  const [r, o] = await Promise.all([
    db.rpc("fin_detail", { eid: id }),
    db.rpc("fin_options"),
  ]);
  if (r.error?.code === "P0001") notFound();
  check(r.error);
  check(o.error);
  const {
    entry: e,
    settlements,
    history,
  } = r.data as {
    entry: FinEntry;
    settlements: Settlement[];
    history: {
      at: string;
      actor: string | null;
      action: string;
      reason: string;
      before: string | null;
      after: string;
    }[];
  };
  const options = o.data as Options;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            ION FINANCE ·{" "}
            {e.kind === "income" ? "CONTA A RECEBER" : "CONTA A PAGAR"}
          </p>
          <h1>{e.description}</h1>
          <p className="muted">
            {statuses[e.status]} · Competência {e.competence} · Vencimento{" "}
            {e.due_at}
          </p>
        </div>
        <Link className="button" href={"/finance?view=" + e.kind}>
          Voltar aos lançamentos
        </Link>
      </div>
      <Notice params={await searchParams} />
      <div className="stats">
        {[
          ["Valor", e.amount],
          ["Liquidado", e.paid],
          ["Saldo restante", e.balance],
        ].map(([n, v]) => (
          <div key={n} className="stat">
            <span>{n}</span>
            <strong>{brl(v)}</strong>
          </div>
        ))}
      </div>
      <section className="panel padded">
        <h2>Origem</h2>
        <p>
          Cliente:{" "}
          {options.companies.find((c) => c.id === e.company_id)?.name ??
            e.company ??
            "Avulso"}
        </p>
        {e.company_id && (
          <Link href={"/clients/" + e.company_id}>
            Abrir cliente e contratos
          </Link>
        )}
        <p>
          Contrato:{" "}
          {options.contracts.find((c) => c.id === e.contract_id)?.reference ??
            e.commercial_reference ??
            e.commercial_contract_id ??
            "Sem contrato"}
        </p>
        {e.rule_id && (
          <>
            <p>
              Comissão aprovada. O próprio lançamento é a despesa; pagamentos
              não criam outra despesa.
            </p>
            <details>
              <summary>Condições da regra na aprovação</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(e.rule_snapshot, null, 2)}
              </pre>
            </details>
          </>
        )}
      </section>
      {e.state !== "cancelled" && cents(e.balance) > 0n && (
        <section className="panel padded">
          <h2>
            Registrar {e.kind === "income" ? "recebimento" : "pagamento"}{" "}
            parcial ou integral
          </h2>
          <ConfirmedAdminForm
            action={settle}
            confirmation="Confirmar a liquidação efetiva deste valor?"
            submitLabel="Registrar liquidação"
          >
            <input type="hidden" name="entry_id" value={e.id} />
            <input type="hidden" name="request_id" value={randomUUID()} />
            <Field
              name="amount"
              label="Valor liquidado em reais"
              value={e.balance}
            />
            <Field
              name="paid_at"
              label="Data efetiva da liquidação"
              type="date"
              value={today}
            />
            <Field name="method" label="Forma de pagamento" />
            <Field name="notes" label="Observações" required={false} />
          </ConfirmedAdminForm>
        </section>
      )}
      <section className="panel padded">
        <h2>Histórico de liquidações e estornos</h2>
        {settlements.length ? (
          settlements.map((s) => (
            <div key={s.id}>
              <p>
                {s.reversal_of ? "Estorno" : "Liquidação"} · {s.paid_at} ·{" "}
                {brl(s.amount)} · {s.method} · {s.notes}
              </p>
              {!s.reversal_of &&
                !settlements.some((x) => x.reversal_of === s.id) &&
                e.state !== "cancelled" && (
                  <details>
                    <summary>Estornar esta liquidação integralmente</summary>
                    <ConfirmedAdminForm
                      action={settle}
                      confirmation="Estornar integralmente esta liquidação? O registro original será preservado."
                      submitLabel="Confirmar estorno"
                    >
                      <input type="hidden" name="entry_id" value={e.id} />
                      <input
                        type="hidden"
                        name="request_id"
                        value={randomUUID()}
                      />
                      <input type="hidden" name="reversal_of" value={s.id} />
                      <input type="hidden" name="amount" value={s.amount} />
                      <input type="hidden" name="method" value={s.method} />
                      <Field
                        name="paid_at"
                        label="Data do estorno"
                        type="date"
                        value={today}
                      />
                      <Field name="notes" label="Justificativa do estorno" />
                    </ConfirmedAdminForm>
                  </details>
                )}
            </div>
          ))
        ) : (
          <Empty>Nenhuma liquidação registrada.</Empty>
        )}
      </section>
      {e.state !== "cancelled" && (
        <section className="panel padded">
          <details>
            <summary>
              Editar lançamento, renegociar vencimento ou cancelar
            </summary>
            <p>
              Origem e tipo são preservados. Reduções não podem ficar abaixo do
              liquidado. Para cancelar, estorne primeiro os pagamentos.
            </p>
            <EntryForm options={options} kind={e.kind} entry={e} />
          </details>
        </section>
      )}
      <section className="panel padded">
        <h2>Auditoria</h2>
        {history.map((h, i) => (
          <details key={i}>
            <summary>
              {new Date(h.at).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}{" "}
              · {h.actor ?? "Autor indisponível"} · {h.action} · {h.reason}
            </summary>
            <p>Estado anterior</p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {h.before ?? "Novo registro"}
            </pre>
            <p>Estado posterior</p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {h.after}
            </pre>
          </details>
        ))}
      </section>
    </>
  );
}
