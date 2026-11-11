import { Select } from "./ui";
import type { CampaignOption } from "@/lib/campaign-selection";
export function CampaignPicker({
  campaigns,
  selected,
}: {
  campaigns: CampaignOption[];
  selected?: string;
}) {
  return campaigns.length > 1 ? (
    <form method="get" className="filters">
      <Select name="campaign" label="Campanha" value={selected}>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ·{" "}
            {c.state === "active"
              ? "Ativa"
              : c.state === "draft"
                ? "Em configuração"
                : c.state === "ended"
                  ? "Encerrada"
                  : "Finalizada"}
          </option>
        ))}
      </Select>
      <button className="button">Consultar campanha</button>
    </form>
  ) : null;
}
