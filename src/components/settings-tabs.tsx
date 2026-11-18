/**
 * Admin › Settings (owner, Nov 16, the shorter menu): Users & access and Reminders were two rows
 * of the menu's Admin group; they are now the two tabs of one Settings entry. Each keeps its own
 * page and address (/admin/users, /admin/reminders) and shows this strip at the top with its own
 * tab lit, so old links and bookmarks still open. Admins only, as both pages already are
 * (access.ts pageForPath: admin).
 */
import { Link } from "@tanstack/react-router";
import { BellRing, Settings, ShieldCheck, Users } from "lucide-react";

import { SETTINGS_TABS, type SettingsTab } from "@/lib/menu-places";

const ICONS = { users: Users, reminders: BellRing, "roof-care": ShieldCheck } as const;

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <div className="space-y-2" data-settings-tabs>
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Settings className="h-4 w-4" aria-hidden /> Settings
      </p>
      {/* Links to two pages, so navigation, not tabs (Nov 16 audit, fix 27): the page being
          shown is marked as the current page. */}
      <nav className="inline-flex flex-wrap rounded-md border p-0.5" aria-label="Settings">
        {SETTINGS_TABS.map((t) => {
          const on = t.key === active;
          const Icon = ICONS[t.key];
          return (
            <Link
              key={t.key}
              to={t.to}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition-colors ${
                on ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
