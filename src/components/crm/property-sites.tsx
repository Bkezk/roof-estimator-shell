/**
 * A property's named sites on the Customers page (owner, Oct 6): the names as chips under the
 * property. They are added and changed in the property's own form (Add property / the pencil;
 * site-form.tsx), not here. Nothing shows when the property has none.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listPropertySites } from "@/lib/property-sites.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PropertySites({ propertyId }: { propertyId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listPropertySites);
  const q = useQuery({
    queryKey: ["property-sites", propertyId],
    queryFn: () => listFn({ data: { property_id: propertyId } }),
    enabled: !!session,
  });
  if (q.error)
    return (
      <p className="mt-1 text-xs text-destructive">Could not load the sites: {errText(q.error)}</p>
    );
  const sites = q.data ?? [];
  if (!sites.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sites">
      <span className="inline-flex items-center gap-1 font-medium">
        <Building2 className="h-3.5 w-3.5" /> Sites:
      </span>
      {sites.map((s) => (
        <span
          key={s.id}
          className="rounded-full border bg-background px-2 py-0.5"
          title={s.notes ?? undefined}
        >
          {s.name}
        </span>
      ))}
    </div>
  );
}
