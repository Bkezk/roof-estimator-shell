/**
 * The site box under a picked customer (owner, Oct 1: the customer search lists customers only;
 * the site is chosen here). Lists the customer's live sites from the account detail (the same
 * ["account", id] query the ticket and the bid already read). `required` drops the "No site"
 * choice (a ticket for a customer with several sites); otherwise the site stays optional.
 *
 * `allowAdd` (the opportunity, owner Oct 2: every opportunity names a site): a customer with no
 * site gets "Add site", which opens the Customers page's own site form (crm/site-form.tsx) in a
 * dialog; the saved site is picked. Only for those who may add sites (Customers access, which
 * admins and managers have); anyone else sees the "No sites on file" line alone.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { getAccount, siteAddressLine, type AccountDetail, type SiteRow } from "@/lib/crm.functions";
import { siteOptionLabel } from "@/lib/county-codes";
import { useCountyCodes } from "@/components/crm/use-county-codes";
import { SiteForm } from "@/components/crm/site-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  /** A customer with no site: offer "Add site" (the Customers page's site form). */
  allowAdd?: boolean;
}) {
  const { session, can } = useAuth();
  const qc = useQueryClient();
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
  // Who adds a site here: Customers access (admins and managers have it).
  const mayAdd = !!props.allowAdd && can("customers");
  const [adding, setAdding] = useState(false);
  if (detail.error)
    return (
      <p className="text-xs text-destructive">
        Could not load the properties: {errText(detail.error)}
      </p>
    );
  if (detail.data && sites.length === 0 && !props.value)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">No properties on file for this customer.</p>
        {mayAdd && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled}
              onClick={() => setAdding(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add site
            </Button>
            <Dialog open={adding} onOpenChange={setAdding}>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>New property</DialogTitle>
                  <DialogDescription>
                    The building or address the work happens at. It is saved on the customer.
                  </DialogDescription>
                </DialogHeader>
                <SiteForm
                  accountId={props.accountId}
                  site={null}
                  onDone={(changed, row) => {
                    setAdding(false);
                    if (!changed || !row) return;
                    // The new site is in the list at once (then re-read), and picked.
                    qc.setQueryData<AccountDetail>(["account", props.accountId], (d) =>
                      d ? { ...d, sites: [...d.sites, row] } : d,
                    );
                    void qc.invalidateQueries({ queryKey: ["account", props.accountId] });
                    void qc.invalidateQueries({ queryKey: ["accounts"] });
                    void qc.invalidateQueries({ queryKey: ["account-search"] });
                    props.onChange(row);
                  }}
                />
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
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
        <SelectValue
          placeholder={detail.isLoading ? "Loading the properties…" : "Pick the property…"}
        />
      </SelectTrigger>
      <SelectContent>
        {!props.required && <SelectItem value="none">No property</SelectItem>}
        {sites.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {siteOptionLabel(s.name, siteAddressLine(s), codeOf(s.county_code_id))}
          </SelectItem>
        ))}
        {/* A site since removed from the customer stays readable on an old record. */}
        {!known && !detail.isLoading && props.value && (
          <SelectItem value={props.value}>Former property</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
