/**
 * The Service page's views as tabs (owner, Sep 28: one menu entry, not four): Tickets, Tech
 * Board and Invoices are views of the same work, so they sit on one row under the page title.
 * The Tech Board tab (owner, Oct 5: it used to sit folded above the ticket list) shows to
 * managers and admins, who dispatch (`managesTickets`); the Invoices tab to admins, managers and
 * sales / project managers (`seesInvoices`; owner, Oct 1); anyone else sees Tickets only.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, Receipt, Wrench } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets, seesInvoices, type AccessLike } from "@/lib/access";
import { AWAITING_INVOICE_TITLE } from "@/lib/invoice-search";
import { cn } from "@/lib/utils";

const everyone = () => true;
const TABS: readonly {
  title: string;
  to: "/service" | "/service/board" | "/service/invoices";
  icon: typeof Wrench;
  show: (p: AccessLike | null | undefined) => boolean;
}[] = [
  { title: "Tickets", to: "/service", icon: Wrench, show: everyone },
  { title: "Tech Board", to: "/service/board", icon: CalendarDays, show: managesTickets },
  { title: "Invoices", to: "/service/invoices", icon: Receipt, show: seesInvoices },
];

export function ServiceTabs({ toInvoice }: { toInvoice?: number }) {
  const { profile } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = TABS.filter((t) => t.show(profile));
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
              // Awaiting invoice (owner, Oct 1: the plainer name for "to invoice").
              <span
                className="ml-1 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground"
                title={AWAITING_INVOICE_TITLE}
                aria-label={`${toInvoice} awaiting invoice`}
              >
                {toInvoice}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
