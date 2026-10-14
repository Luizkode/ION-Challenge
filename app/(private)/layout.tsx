import Link from "next/link";
import { session } from "@/lib/session";
import { logout } from "@/app/actions";
import { LogOut, ArrowUpRight } from "lucide-react";
import { Live } from "@/components/live";
import { OSNavigation } from "@/components/os-navigation";
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
          ION<span> / OS</span>
        </Link>
        <p className="eyebrow nav-label">AGENCY OPERATING SYSTEM</p>
        <OSNavigation role={profile.role} />
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
          <span className="muted">ION OS</span>
          <Live />
          <Link
            className="profile-link muted small"
            href="/history"
            title={profile.name}
          >
            {profile.name}
          </Link>
          {profile.role === "sdr" && (
            <Link href="/meetings/new" className="button">
              + Nova reunião <ArrowUpRight size={16} />
            </Link>
          )}
        </header>
        <main className="content">{children}</main>
        <footer>
          AGÊNCIA ION <span>Agency Operating System</span>
        </footer>
      </div>
    </div>
  );
}
