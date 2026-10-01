/**
 * The Service page's views as tabs (owner, Sep 28: one menu entry, not four): Tickets, Board and
 * Invoices are views of the same work, so they sit on one row under the page title. Anyone but
 * a manager or an admin sees Tickets only (the board and money are a manager's; owner, Oct 1).
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { Receipt, Wrench } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import { cn } from "@/lib/utils";

const TABS = [
  { title: "Tickets", to: "/service", icon: Wrench, office: false },
  { title: "Invoices", to: "/service/invoices", icon: Receipt, office: true },
] as const;

export function ServiceTabs({ toInvoice }: { toInvoice?: number }) {
  const { profile } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Invoices are a manager's (owner, Oct 1).
  const manager = managesTickets(profile);
  const tabs = TABS.filter((t) => !t.office || manager);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Service views" className="flex flex-wrap gap-1 border-b">
      {tabs.map((t) => {
        const active = t.to === "/service" ? pathname === "/service" : pathname.startsWith(t.to);
        return (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.title}
            {t.to === "/service/invoices" && toInvoice ? (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                {toInvoice}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
