import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/session";
import { createMeeting } from "@/app/actions";
import { Field, Select, Notice } from "@/components/ui";
import { Submit } from "@/components/submit";
import { registrationBlockers } from "@/lib/meeting-registration";
export default async function NewMeeting({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db, profile } = await session();
  if (profile.role !== "sdr") redirect("/meetings");
  const params = await searchParams;
  const [campaignResult, closerResult] = await Promise.all([
    db
      .from("campaigns")
      .select("id,state,starts_at,ends_at")
      .eq("state", "active")
      .maybeSingle(),
    db
      .from("profiles")
      .select("id,name")
      .eq("role", "closer")
      .eq("active", true)
      .order("name"),
  ]);
  const campaign = campaignResult.data;
  const [participantResult, opportunityResult] = campaign
    ? await Promise.all([
        db
          .from("campaign_participants")
          .select("team_id")
          .eq("campaign_id", campaign.id)
          .eq("profile_id", profile.id)
          .maybeSingle(),
        db
          .from("opportunities")
          .select("id,company,phone")
          .eq("campaign_id", campaign.id)
          .eq("sdr_id", profile.id)
          .order("company"),
      ])
    : [
        { data: null, error: null },
        { data: [], error: null },
      ];
  const queryFailed = [
    campaignResult,
    closerResult,
    participantResult,
    opportunityResult,
  ].some((r) => r.error);
  const blockers = queryFailed
    ? [
        "Não foi possível carregar os requisitos do cadastro. Tente novamente; se persistir, contate o administrador.",
      ]
    : registrationBlockers(
        campaign,
        Boolean(participantResult.data?.team_id),
        closerResult.data?.length ?? 0,
      );
  const disabled = blockers.length > 0;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">OPERAÇÃO</p>
          <h1>Nova reunião</h1>
          <p className="muted">
            SDR responsável: {profile.name}. A pontuação vem após a validação.
          </p>
        </div>
        <Link href="/meetings" className="button">
          Minhas reuniões
        </Link>
      </div>
      <Notice params={params} />
      <section className="panel">
        <div className="panel-title">
          <h2>Cadastro de reunião</h2>
          <span className="badge">0 pontos até validar</span>
        </div>
        {blockers.map((reason) => (
          <div className="padded" key={reason}>
            <p className="notice" role="alert">
              {reason}
            </p>
          </div>
        ))}
        <form action={createMeeting}>
          <input type="hidden" name="campaign_id" value={campaign?.id ?? ""} />
          <fieldset
            disabled={disabled}
            className="form-grid padded"
            aria-label="Dados da reunião"
          >
            <Field label="Empresa" name="company" />
            <Field label="Responsável" name="contact" />
            <Field
              label="Telefone / WhatsApp (com DDD)"
              name="phone"
              type="tel"
            />
            <Field label="Cidade" name="city" />
            <Field label="Nicho" name="niche" />
            <Field
              label="Data e horário (seu horário local)"
              name="scheduled_at"
              type="datetime-local"
            />
            <Select label="Closer responsável" name="closer_id" required>
              <option value="">Selecione</option>
              {closerResult.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              label="Oportunidade (revise possíveis duplicidades)"
              name="opportunity_id"
            >
              <option value="">Nova oportunidade</option>
              {opportunityResult.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.company} · {o.phone}
                </option>
              ))}
            </Select>
            <Field label="Observações" name="notes" required={false} />
            <p className="small muted">
              Reuniões da mesma oportunidade contam uma única vez. Telefone
              repetido exige reutilizar a oportunidade ou revisão
              administrativa.
            </p>
            <Submit disabled={disabled}>Cadastrar reunião</Submit>
          </fieldset>
        </form>
      </section>
    </>
  );
}
