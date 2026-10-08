import { z } from "zod";
export type RegistrationCampaign = {
  id: string;
  state: string;
  starts_at: string | null;
  ends_at: string | null;
};
export function registrationBlockers(
  campaign: RegistrationCampaign | null,
  hasTeam: boolean,
  closerCount: number,
  now = Date.now(),
) {
  const reasons: string[] = [];
  if (!campaign || campaign.state !== "active")
    reasons.push(
      "A campanha ainda não está ativa. Aguarde a ativação pelo administrador.",
    );
  else if (!campaign.starts_at || !campaign.ends_at)
    reasons.push(
      "O período da campanha não está configurado. Contate o administrador.",
    );
  else if (now < new Date(campaign.starts_at).getTime())
    reasons.push(
      "A campanha ainda não começou. Aguarde a data oficial de início.",
    );
  else if (now >= new Date(campaign.ends_at).getTime())
    reasons.push(
      "O período da campanha foi encerrado. Não é possível agendar novas reuniões.",
    );
  if (campaign && !hasTeam)
    reasons.push(
      "Você não está vinculado a um time nesta campanha. Peça ao administrador para cadastrar seu vínculo.",
    );
  if (!closerCount)
    reasons.push(
      "Não há closer ativo disponível. Peça ao administrador para cadastrar ou ativar um closer.",
    );
  return reasons;
}
export const meetingSchema = z.object({
  campaign_id: z.string().uuid(),
  company: z.string().trim().min(2).max(150),
  contact: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().min(10).max(15)),
  city: z.string().trim().min(2).max(100),
  niche: z.string().trim().min(2).max(100),
  closer_id: z.string().uuid(),
  scheduled_at: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).default(""),
  opportunity_id: z.string().optional(),
});
