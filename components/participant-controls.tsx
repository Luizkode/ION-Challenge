import Link from "next/link";
import { Field, Select } from "@/components/ui";
import { ConfirmedAdminForm } from "@/components/confirmed-admin-form";
type Profile = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  user_functions?: { function_code: string }[];
};
type Membership = { team_id: string | null; active: boolean };
export function ParticipantControls({
  profile,
  campaignId,
  membership,
  teams,
  automatic = false,
}: {
  profile: Profile;
  automatic?: boolean;
  campaignId?: string;
  membership?: Membership;
  teams: { id: string; name: string }[];
}) {
  const isSdr = profile.user_functions
    ? profile.user_functions.some((f) => f.function_code === "sdr")
    : profile.role === "sdr";
  return (
    <>
      {["member", "partner"].includes(profile.role) ? (
        <Link href="/team">Alterar perfil na Equipe</Link>
      ) : (
        <details>
          <summary>Alterar perfil</summary>
          <ConfirmedAdminForm
            confirmation={`Confirma alterar o perfil de ${profile.name}?`}
            submitLabel="Salvar perfil"
          >
            <input type="hidden" name="operation" value="profile" />
            <input type="hidden" name="id" value={profile.id} />
            <input type="hidden" name="name" value={profile.name} />
            <input type="hidden" name="active" value={String(profile.active)} />
            <Select
              label={`Perfil de ${profile.name}`}
              name="role"
              value={profile.role}
            >
              <option value="sdr">SDR</option>
              <option value="closer">Closer</option>
              <option value="admin">Administrador</option>
            </Select>
            {membership?.active && !automatic && (
              <label className="small">
                <input
                  type="checkbox"
                  name="remove_from_campaign"
                  value="true"
                  style={{ width: "auto", minHeight: 0, marginRight: 8 }}
                />
                Remover da campanha durante a alteração de perfil
              </label>
            )}
            <Field label="Justificativa" name="reason" />
          </ConfirmedAdminForm>
        </details>
      )}
      {campaignId && membership?.active && isSdr && profile.active && (
        <details>
          <summary>
            {membership.team_id ? "Alterar time" : "Definir time"}
          </summary>
          <ConfirmedAdminForm
            confirmation={`Confirma alterar o time de ${profile.name}? Com histórico, o time original será preservado.`}
            submitLabel="Salvar time"
          >
            <input type="hidden" name="operation" value="participant" />
            <input type="hidden" name="campaign_id" value={campaignId} />
            <input type="hidden" name="profile_id" value={profile.id} />
            <Select
              label={`Time de ${profile.name}`}
              name="team_id"
              value={membership.team_id ?? ""}
              required
            >
              <option value="">Selecione uma equipe</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Field label="Justificativa da alteração de time" name="reason" />
          </ConfirmedAdminForm>
        </details>
      )}
      {automatic ? (
        <p className="small muted">
          Participação automática para SDRs ativos. A função e o acesso são
          gerenciados na <Link href="/team">Equipe</Link>.{" "}
          {membership?.active &&
            !membership.team_id &&
            "Sem equipe definida; nenhuma alocação automática."}
        </p>
      ) : campaignId && membership?.active ? (
        <details>
          <summary>Remover da campanha</summary>
          <ConfirmedAdminForm
            confirmation={`Confirma remover ${profile.name} da campanha? A pessoa sairá dos rankings, mas reuniões, contratos e histórico serão preservados.`}
            submitLabel="Remover da campanha"
          >
            <input type="hidden" name="operation" value="participant" />
            <input type="hidden" name="campaign_id" value={campaignId} />
            <input type="hidden" name="profile_id" value={profile.id} />
            <input type="hidden" name="remove" value="true" />
            <Field label="Justificativa da remoção" name="reason" />
          </ConfirmedAdminForm>
        </details>
      ) : campaignId && isSdr && profile.active ? (
        <details>
          <summary>Adicionar à campanha</summary>
          <ConfirmedAdminForm
            confirmation={`Confirma adicionar ${profile.name} à campanha? Os resultados anteriores desta campanha voltarão ao ranking.`}
            submitLabel="Adicionar à campanha"
          >
            <input type="hidden" name="operation" value="participant" />
            <input type="hidden" name="campaign_id" value={campaignId} />
            <input type="hidden" name="profile_id" value={profile.id} />
            <Select
              label={`Time de ${profile.name}`}
              name="team_id"
              value={membership?.team_id ?? ""}
            >
              <option value="">Selecione</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Field label="Justificativa da inclusão" name="reason" />
          </ConfirmedAdminForm>
        </details>
      ) : null}
    </>
  );
}
