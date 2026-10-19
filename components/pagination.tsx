import Link from "next/link";
import { pageHref, pageSize } from "@/lib/pagination";
export function Pagination({
  path,
  params,
  page,
  total,
  size = pageSize,
  label = "Paginação",
  pageKey = "page",
}: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  total: number;
  size?: number;
  label?: string;
  pageKey?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="pagination" aria-label={label}>
      <p className="small muted">
        {total.toLocaleString("pt-BR")} registro(s) · página {page} de {pages}
      </p>
      <div className="crm-actions">
        {page > 1 && (
          <Link
            className="button"
            href={pageHref(path, params, page - 1, pageKey)}
          >
            Anterior
          </Link>
        )}
        {page < pages && (
          <Link
            className="button"
            href={pageHref(path, params, page + 1, pageKey)}
          >
            Próxima
          </Link>
        )}
      </div>
    </nav>
  );
}
