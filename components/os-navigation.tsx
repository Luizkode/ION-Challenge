"use client";
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
  return (
    <nav aria-label="Módulos do ION OS">
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
                  ["/meetings", "/validation"].some((p) => path.startsWith(p)));
          return (
            <Link
              key={m.id}
              href={m.path}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={18} />
              {m.name}
            </Link>
          );
        })}
    </nav>
  );
}
