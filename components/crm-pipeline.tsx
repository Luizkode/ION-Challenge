"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveLead } from "@/app/crm-actions";
import { stages, stageCodes, type Lead } from "@/lib/crm";
export function CrmPipeline({ leads }: { leads: Lead[] }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  function move(id: string, stage: string) {
    start(async () => {
      const r = await moveLead(id, stage);
      setError(r.error ?? "");
      if (!r.error) router.refresh();
    });
  }
  return (
    <>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <p className="table-note">
        Arraste um lead ou escolha uma etapa no cartão. Agendamento, realização
        e negociação usam seus formulários para preservar validações. Exibindo
        os leads desta página.
      </p>
      <div className="crm-pipeline" aria-busy={pending}>
        {stageCodes.map((stage) => (
          <section
            key={stage}
            className="crm-column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              move(e.dataTransfer.getData("text/plain"), stage);
            }}
          >
            <h3>{stages[stage]}</h3>
            {leads
              .filter((l) => l.stage === stage)
              .map((l) => (
                <article
                  className="panel padded"
                  key={l.id}
                  draggable={!pending}
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", l.id)
                  }
                >
                  <Link href={"/crm/" + l.id}>
                    <strong>{l.company}</strong>
                  </Link>
                  <p className="muted small">{l.contact}</p>
                  <label className="field">
                    <span>Mover {l.company}</span>
                    <select
                      value={stage}
                      disabled={pending}
                      onChange={(e) => move(l.id, e.target.value)}
                    >
                      {stageCodes.map((s) => (
                        <option key={s} value={s}>
                          {stages[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
