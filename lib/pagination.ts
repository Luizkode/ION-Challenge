export const pageSize = 40;
export function pageNumber(value?: string) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1;
}
export function pageHref(
  path: string,
  params: Record<string, string | undefined>,
  page: number,
  key = "page",
) {
  const q = new URLSearchParams(
    Object.entries(params).filter(
      ([k, v]) => v !== undefined && !["error", "success"].includes(k),
    ) as [string, string][],
  );
  q.set(key, String(page));
  return path + "?" + q;
}
