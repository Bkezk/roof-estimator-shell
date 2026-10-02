/**
 * The site box under a picked customer (owner, Oct 1: the customer search lists customers only;
 * the site is chosen here). Lists the customer's live sites from the account detail (the same
 * ["account", id] query the ticket and the bid already read). `required` drops the "No site"
 * choice (a ticket for a customer with several sites); otherwise the site stays optional.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { getAccount, siteAddressLine, type SiteRow } from "@/lib/crm.functions";
import { siteOptionLabel } from "@/lib/county-codes";
import { useCountyCodes } from "@/components/crm/use-county-codes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SiteSelect(props: {
  accountId: string;
  value: string | null;
  onChange: (site: SiteRow | null) => void;
  id?: string;
  disabled?: boolean;
  /** No "No site" choice. */
  required?: boolean;
  /** Red outline (the form says why underneath). */
  invalid?: boolean;
  className?: string;
}) {
  const { session } = useAuth();
  const getFn = useServerFn(getAccount);
  const detail = useQuery({
    queryKey: ["account", props.accountId],
    queryFn: () => getFn({ data: { id: props.accountId } }),
    enabled: !!session,
  });
  const sites = detail.data?.sites ?? [];
  // The site's JBK county code after the address (the shared, cached list).
  const codes = useCountyCodes().data;
  // The whole code row: "0108 Kenton, KY" (0108 alone is Kenton, KY or Putman, TN).
  const codeOf = (id: string | null) => (id ? codes?.find((c) => c.id === id) : undefined);
  if (detail.error)
    return (
      <p className="text-xs text-destructive">Could not load the sites: {errText(detail.error)}</p>
    );
  if (detail.data && sites.length === 0 && !props.value)
    return <p className="text-xs text-muted-foreground">No sites on file for this customer.</p>;
  const known = !props.value || sites.some((s) => s.id === props.value);
  return (
    <Select
      value={props.value ?? (props.required ? "" : "none")}
      disabled={props.disabled || detail.isLoading}
      onValueChange={(v) => props.onChange(sites.find((s) => s.id === v) ?? null)}
    >
      <SelectTrigger
        id={props.id}
        aria-invalid={props.invalid || undefined}
        className={`${props.invalid ? "border-destructive" : ""} ${props.className ?? ""}`}
      >
        <SelectValue placeholder={detail.isLoading ? "Loading the sites…" : "Pick the site…"} />
      </SelectTrigger>
      <SelectContent>
        {!props.required && <SelectItem value="none">No site</SelectItem>}
        {sites.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {siteOptionLabel(s.name, siteAddressLine(s), codeOf(s.county_code_id))}
          </SelectItem>
        ))}
        {/* A site since removed from the customer stays readable on an old record. */}
        {!known && !detail.isLoading && props.value && (
          <SelectItem value={props.value}>Former site</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
