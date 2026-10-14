import { Field, Select } from "@/components/ui";
import { ConfirmedAdminForm } from "@/components/confirmed-admin-form";
type Profile = { id: string; name: string; role: string; active: boolean };
type Membership = { team_id: string; active: boolean };
export function ParticipantControls({
  profile,
  campaignId,
  membership,
  teams,
}: {
  profile: Profile;
  campaignId?: string;
  membership?: Membership;
  teams: { id: string; name: string }[];
}) {
  return (
    <>
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
          {membership?.active && (
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
      {campaignId &&
        membership?.active &&
        profile.role === "sdr" &&
        profile.active && (
          <details>
            <summary>Alterar time</summary>
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
                value={membership.team_id}
              >
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
      {campaignId && membership?.active ? (
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
      ) : campaignId && profile.role === "sdr" && profile.active ? (
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
              value={membership?.team_id}
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
