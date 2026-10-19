"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseLeadCsv, type LeadInput, type Person } from "@/lib/crm";
import { importLeads } from "@/app/crm-actions";
export function CrmImport({
  people,
  admin,
}: {
  people: Person[];
  admin: boolean;
}) {
  const [rows, setRows] = useState<LeadInput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [owner, setOwner] = useState(people.find((p) => p.is_sdr)?.id ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <details className="padded">
      <summary>Importar leads por CSV</summary>
      <p className="small muted">
        Até 500 linhas / 2 MB. Obrigatórios: company, contact, phone, niche,
        city, state, source. Opcionais: email, closer_id, notes. A importação é
        integral: nenhuma linha é salva se houver erro ou duplicidade.
      </p>
      {admin && (
        <label className="field">
          <span>SDR dos leads importados</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people
              .filter((p) => p.is_sdr)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Arquivo CSV</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={async (e) => {
            setRows([]);
            setErrors([]);
            setMessage("");
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 2_000_000) {
              setErrors(["Arquivo excede 2 MB."]);
              return;
            }
            try {
              const p = parseLeadCsv(await f.text());
              setRows(p.rows);
              setErrors(p.errors);
            } catch {
              setErrors(["Não foi possível ler o arquivo."]);
            }
          }}
        />
      </label>
      {errors.map((error, i) => (
        <p key={i} className="notice error" role="alert">
          {error}
        </p>
      ))}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <h3>Prévia · {rows.length} leads</h3>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Tabela com rolagem horizontal"
          >
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Contato</th>
                  <th>WhatsApp</th>
                  <th>Cidade / UF</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td>{r.company}</td>
                    <td>{r.contact}</td>
                    <td>{r.phone}</td>
                    <td>
                      {r.city} / {r.state}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Prévia das primeiras 20 linhas. Duplicidades no banco serão
            verificadas ao confirmar.
          </p>
          <button
            type="button"
            className="button"
            disabled={pending || errors.length > 0 || (admin && !owner)}
            onClick={() =>
              start(async () => {
                try {
                  const result = await importLeads(
                    rows.map((r) => ({
                      ...r,
                      ...(admin ? { sdr_id: owner } : {}),
                    })),
                  );
                  if (result.error) setErrors([result.error]);
                  else {
                    setRows([]);
                    setMessage(`${result.count} leads importados.`);
                    router.refresh();
                  }
                } catch {
                  setErrors([
                    "Não foi possível importar. Verifique a conexão; a prévia foi preservada.",
                  ]);
                }
              })
            }
          >
            {pending ? "Importando…" : "Confirmar importação"}
          </button>
        </>
      )}
    </details>
  );
}
