export type CampaignOption = {
  id: string;
  state: string;
  starts_at: string | null;
  name?: string;
  audience?: string;
};
/** Stable default keeps the earliest active campaign primary; explicit IDs never silently switch. */
export function chooseCampaign<T extends CampaignOption>(
  campaigns: T[],
  id?: string,
): T | undefined {
  if (id) return campaigns.find((c) => c.id === id);
  const priority: Record<string, number> = {
    active: 0,
    draft: 1,
    ended: 2,
    finalized: 3,
  };
  return [...campaigns].sort(
    (a, b) =>
      (priority[a.state] ?? 4) - (priority[b.state] ?? 4) ||
      (a.starts_at ?? "9999").localeCompare(b.starts_at ?? "9999") ||
      a.id.localeCompare(b.id),
  )[0];
}
