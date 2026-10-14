import { Field, Select } from "@/components/ui";
import { functionLabels } from "@/lib/access";
export function AccessFields({
  profile,
  functions = [],
  bindings = [],
  companies,
}: {
  profile?: { name: string; category: string; active: boolean };
  functions?: string[];
  bindings?: string[];
  companies: { id: string; name: string }[];
}) {
  return (
    <>
      <Field label="Nome" name="name" value={profile?.name} />
      <Select
        label="Categoria de acesso"
        name="category"
        value={profile?.category ?? "employee"}
      >
        <option value="admin">Administrador</option>
        <option value="employee">Colaborador</option>
        <option value="partner">Parceiro</option>
      </Select>
      <Select
        label="Situação do acesso"
        name="active"
        value={String(profile?.active ?? true)}
      >
        <option value="true">Ativo</option>
        <option value="false">Inativo</option>
      </Select>
      <fieldset>
        <legend className="small muted">
          Funções · somente colaboradores (selecione uma ou mais)
        </legend>
        {Object.entries(functionLabels).map(([code, label]) => (
          <label className="field small" key={code}>
            <span>
              <input
                type="checkbox"
                name="functions"
                value={code}
                defaultChecked={functions.includes(code)}
                style={{ width: "auto", minHeight: 0, marginRight: 8 }}
              />
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="small muted">
          Empresas · clientes atribuídos ou empresas do parceiro
        </legend>
        {companies.length ? (
          companies.map((c) => (
            <label className="field small" key={c.id}>
              <span>
                <input
                  type="checkbox"
                  name="company_ids"
                  value={c.id}
                  defaultChecked={bindings.includes(c.id)}
                  style={{ width: "auto", minHeight: 0, marginRight: 8 }}
                />
                {c.name}
              </span>
            </label>
          ))
        ) : (
          <p className="small muted">
            Cadastre uma empresa antes de convidar parceiros ou atribuir
            clientes.
          </p>
        )}
      </fieldset>
      <label className="small">
        <input
          type="checkbox"
          name="remove_from_campaign"
          value="true"
          style={{ width: "auto", minHeight: 0, marginRight: 8 }}
        />
        Remover participação na campanha ao retirar a função SDR
      </label>
      <Field label="Justificativa (mínimo 8 caracteres)" name="reason" />
    </>
  );
}
