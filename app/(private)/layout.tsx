import Link from "next/link";
import { session } from "@/lib/session";
import { logout } from "@/app/actions";
import {
  LayoutDashboard,
  CalendarDays,
  CheckCheck,
  Settings,
  LogOut,
  History,
  ArrowUpRight,
} from "lucide-react";
import { Live } from "@/components/live";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await session();
  return (
    <div className="shell">
      <aside>
        <Link className="wordmark" href="/">
          ION<span> / CHALLENGE</span>
        </Link>
        <p className="eyebrow nav-label">WORKSPACE</p>
        <nav>
          <Link href="/">
            <LayoutDashboard size={18} />
            Visão geral
          </Link>
          <Link href="/meetings">
            <CalendarDays size={18} />
            {profile.role === "sdr" ? "Minhas reuniões" : "Reuniões"}
          </Link>
          {profile.role !== "sdr" && (
            <Link href="/validation">
              <CheckCheck size={18} />
              Validação
            </Link>
          )}
          <Link href="/history">
            <History size={18} />
            Meu perfil e histórico
          </Link>
          {profile.role === "admin" && (
            <Link href="/admin">
              <Settings size={18} />
              Administração
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{profile.name.slice(0, 1)}</span>
          <div>
            <strong>{profile.name}</strong>
            <small>{profile.role.toUpperCase()}</small>
          </div>
          <form action={logout}>
            <button className="icon-button" aria-label="Sair">
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <span className="muted">Performance / Challenge</span>
          <Live />
          {profile.role === "sdr" && (
            <Link href="/meetings/new" className="button">
              + Nova reunião <ArrowUpRight size={16} />
            </Link>
          )}
        </header>
        <main className="content">{children}</main>
        <footer>
          AGÊNCIA ION <span>Resultados reais. Reconhecimento justo.</span>
        </footer>
      </div>
    </div>
  );
}
