/**
 * A property's roof warranties (service study M5, owner Oct 5): the list under each property on
 * the Customers page (edited in the property's form since Oct 6) and the badge the ticket and the
 * Today card show while one is in force (src/lib/warranty.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listSiteWarranties } from "@/lib/warranties.functions";
import { inForce, monthYear, warrantyBadges, warrantyLabel } from "@/lib/warranty";
import { Badge } from "@/components/ui/badge";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pad = (n: number) => String(n).padStart(2, "0");
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const warrantyKey = (siteId: string) => ["site-warranties", siteId] as const;

/** The badge(s) on a ticket: the site's warranties in force today; nothing when there are none. */
export function WarrantyBadges({ siteId }: { siteId: string | null | undefined }) {
  const { session } = useAuth();
  const listFn = useServerFn(listSiteWarranties);
  const q = useQuery({
    queryKey: warrantyKey(siteId ?? ""),
    queryFn: () => listFn({ data: { site_id: siteId! } }),
    enabled: !!session && !!siteId,
  });
  const badges = warrantyBadges(q.data ?? [], todayYmd());
  if (!badges.length) return null;
  return <WarrantyBadgeList badges={badges} />;
}

export function WarrantyBadgeList({ badges }: { badges: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Warranty">
      {badges.map((b) => (
        <Badge key={b} variant="outline" className="gap-1 border-primary/40 font-medium">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Warranty: {b}
        </Badge>
      ))}
    </div>
  );
}

/**
 * The property's warranties on the Customers page, read-only. They are added and changed in the
 * property's own form (Add property / the pencil; site-form.tsx — owner, Oct 6). Nothing shows
 * when there are none.
 */
export function SiteWarranties({ siteId }: { siteId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listSiteWarranties);
  const q = useQuery({
    queryKey: warrantyKey(siteId),
    queryFn: () => listFn({ data: { site_id: siteId } }),
    enabled: !!session,
  });
  const list = q.data ?? [];
  const today = todayYmd();
  if (q.error)
    return (
      <p className="mt-1 text-xs text-destructive">Could not load warranties: {errText(q.error)}</p>
    );
  if (!list.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {list.map((w) => (
        <div key={w.id} className="flex flex-wrap items-center gap-2 text-xs">
          <ShieldCheck
            className={`h-3.5 w-3.5 ${inForce(w, today) ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden
          />
          <span className="font-medium">Warranty: {warrantyLabel(w)}</span>
          {w.number && <span className="text-muted-foreground">#{w.number}</span>}
          {w.start_date && (
            <span className="text-muted-foreground">from {monthYear(w.start_date)}</span>
          )}
          {!inForce(w, today) && <Badge variant="secondary">not in force</Badge>}
          {w.notes && <span className="text-muted-foreground">· {w.notes}</span>}
        </div>
      ))}
    </div>
  );
}
