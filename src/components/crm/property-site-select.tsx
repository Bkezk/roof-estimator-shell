/**
 * The site inside a property on a ticket (owner, Oct 6: the description used to name it, as in
 * CenterPoint). Shown only when the property has sites (Customers › the property › Sites);
 * optional. A site since removed from the property still shows on the tickets that name it.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { listPropertySites } from "@/lib/property-sites.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

export function PropertySiteSelect(props: {
  id?: string;
  propertyId: string | null;
  /** "" = none. */
  value: string;
  /** The saved site's name (shown if the site has since been removed from the property). */
  savedName?: string | null;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listPropertySites);
  const q = useQuery({
    queryKey: ["property-sites", props.propertyId],
    queryFn: () => listFn({ data: { property_id: props.propertyId! } }),
    enabled: !!session && !!props.propertyId,
  });
  const sites = q.data ?? [];
  const known = !props.value || sites.some((s) => s.id === props.value);
  if (!props.propertyId || (!sites.length && !props.value)) return null;
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="text-xs font-medium">
        Site
      </label>
      <Select
        value={props.value || NONE}
        disabled={!!props.disabled}
        onValueChange={(v) => props.onChange(v === NONE ? "" : v)}
      >
        <SelectTrigger id={props.id} className="bg-background">
          <SelectValue placeholder="Pick the site…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No site</SelectItem>
          {sites.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
          {!known && (
            <SelectItem value={props.value}>{props.savedName || "Former site"}</SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
