"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ContactRound,
  Trophy,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Wallet,
  Users,
  Handshake,
  Settings,
} from "lucide-react";
import { osModules, canAccessModule } from "@/lib/os-modules";
const icons = {
  dashboard: LayoutDashboard,
  crm: ContactRound,
  challenger: Trophy,
  clients: BriefcaseBusiness,
  analytics: ChartNoAxesCombined,
  finance: Wallet,
  team: Users,
  partners: Handshake,
  settings: Settings,
};
export function OSNavigation({
  profile,
}: {
  profile: import("@/lib/access").Access;
}) {
  const path = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  const id = useId(),
    toggle = useRef<HTMLButtonElement>(null);

  return (
    <div
      className={"module-menu" + (open ? " is-open" : "")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpenPath(null);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="menu-toggle button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpenPath(open ? null : path)}
      >
        Menu de módulos
      </button>
      <nav id={id} aria-label="Módulos do ION OS">
        {osModules
          .filter((m) => canAccessModule(m.id, profile))
          .map((m) => {
            const Icon = icons[m.id];
            const active =
              m.path === "/"
                ? path === "/"
                : path === m.path ||
                  path.startsWith(m.path + "/") ||
                  (m.id === "challenger" &&
                    ["/meetings", "/validation", "/history", "/admin"].some(
                      (p) => path.startsWith(p),
                    ));
            return (
              <Link
                key={m.id}
                href={m.path}
                onClick={() => setOpenPath(null)}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} />
                {m.name}
              </Link>
            );
          })}
      </nav>
    </div>
  );
}
