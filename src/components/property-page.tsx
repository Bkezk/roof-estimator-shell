/**
 * A property's own page, /properties/<uuid> (owner, Oct 15: "make it to where you can click a
 * property to open its own page where you can see its details, how many tickets were there, its
 * sites, etc."). A property is a crm_sites row under a customer: its name, address, JBK county
 * code, technician instructions and notes, its roof Warranties and its named Sites — then what
 * links to it by site_id, each a fold like the customer's page (lib/customer-folds.ts): Tickets
 * (with a line of counts by stage), Opportunities (for those who see the list), Bids (Estimate
 * access only — no prices reach a technician), Tasks (New task starts on this property) and, for
 * admins and managers, History (the audit log's 'site' rows: the property, its sites and its
 * warranties). Takeoffs link by customer and building, not property, so none here.
 *
 * Edit opens the same property form the customer's page uses (SiteForm) in place; New ticket is
 * the customer page's gate (Service access and a dispatcher). A deleted property, or one whose
 * customer is deleted, opens read-only with a banner.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Link2, Loader2, MapPin, Pencil, Trash2, Wrench } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { dispatchesTickets, seesOpportunitiesList } from "@/lib/access";
import {
  getProperty,
  siteAddressLine,
  stageCountsLine,
  type LinkedBidRow,
  type PropertyDetail,
} from "@/lib/crm.functions";
import { deletedLine } from "@/lib/crm-account";
import { AuditHistory } from "@/components/audit-history";
import { FoldHeader } from "@/components/section-fold";
import { INNER_BOX, sectionClass } from "@/lib/section-tints";
import { useSectionFold } from "@/lib/use-section-fold";
import { TicketRows } from "@/components/crm/ticket-rows";
import { OpportunitiesSection, TasksSection } from "@/components/customers-page";
import { CountyCodeLine } from "@/components/crm/county-code-picker";
import { SiteWarranties } from "@/components/crm/site-warranties";
import { PropertySites, SiteCoverPhoto } from "@/components/crm/property-sites";
import { SiteForm } from "@/components/crm/site-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function PropertyPage({ id }: { id: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getProperty);
  const detail = useQuery({
    queryKey: ["property", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
  });
  const account = detail.data?.account;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <MapPin className="h-6 w-6" /> Property
        </h1>
        <Button asChild variant="outline" size="sm">
          {account ? (
            <Link to="/customers/$id" params={{ id: account.id }} title="Open this customer">
              <ArrowLeft className="mr-1 h-4 w-4" /> Customer: {account.name}
            </Link>
          ) : (
            <Link to="/customers">
              <ArrowLeft className="mr-1 h-4 w-4" /> All customers
            </Link>
          )}
        </Button>
      </div>
      {detail.error ? (
        <p className="text-sm text-destructive">
          Could not open the property: {errText(detail.error)}
        </p>
      ) : !detail.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the property…
        </p>
      ) : (
        <PropertyDetailPane id={id} d={detail.data} />
      )}
    </div>
  );
}

function PropertyDetailPane({ id, d }: { id: string; d: PropertyDetail }) {
  const { can, profile } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const s = d.site;
  // Deleted (the property itself, or its customer): read-only — no Edit, New ticket or New task.
  const deleted = !!s.deleted_at || !!d.account.deleted_at;
  // Only a manager creates tickets (owner, Oct 1) — the customer page's gate.
  const canNewTicket = can("service") && dispatchesTickets(profile) && !deleted;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property", id] });
    void qc.invalidateQueries({ queryKey: ["account", d.account.id] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
    void qc.invalidateQueries({ queryKey: ["account-search"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
  return (
    <div className="space-y-6">
      {deleted && (
        <div
          role="status"
          data-banner="deleted"
          className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          <Trash2 className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0 flex-1">
            {s.deleted_at ? (
              <>
                <span className="font-medium">{deletedLine(s.deleted_at, null)}.</span> This
                property is out of the pickers and read-only; tickets at it keep the name and
                address they were saved with.
              </>
            ) : (
              <>
                <span className="font-medium">
                  Its customer was {deletedLine(d.account.deleted_at!, null).toLowerCase()}.
                </span>{" "}
                Everything here is read-only until the customer is restored.
              </>
            )}
          </span>
        </div>
      )}

      <section className={sectionClass("properties")} aria-label="Property details">
        {editing && !deleted ? (
          <SiteForm
            accountId={d.account.id}
            site={s}
            onDone={(changed) => {
              setEditing(false);
              if (changed) refresh();
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold">{s.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {siteAddressLine(s) || "No address on file"}
                </p>
                <CountyCodeLine id={s.county_code_id} className="mt-1 text-xs" />
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">Customer: </span>
                  <Link
                    to="/customers/$id"
                    params={{ id: d.account.id }}
                    className="font-medium underline-offset-2 hover:underline"
                    title="Open this customer"
                  >
                    {d.account.name}
                  </Link>
                </p>
              </div>
              <div className="flex items-center gap-1">
                {canNewTicket && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    title="New service ticket at this property"
                  >
                    <Link to="/service" search={{ new: 1, account: d.account.id, site: s.id }}>
                      <Wrench className="mr-1 h-4 w-4" /> New ticket
                    </Link>
                  </Button>
                )}
                {!deleted && (
                  <Button
                    size="sm"
                    variant="outline"
                    title="Edit this property"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="mr-1 h-4 w-4" /> Edit
                  </Button>
                )}
              </div>
            </div>
            {s.technician_instructions && (
              <p className="whitespace-pre-line text-sm">
                <span className="font-medium">Technician instructions: </span>
                {s.technician_instructions}
              </p>
            )}
            {s.notes && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                <span className="font-medium">Notes: </span>
                {s.notes}
              </p>
            )}
            {/* The roof warranties (M5) and the named sites inside the property (Oct 6). */}
            <SiteWarranties siteId={s.id} />
            <PropertySites propertyId={s.id} />
            {/* Phase 2 of the documents (Oct 26): the cover photo a document's cover page prints. */}
            <SiteCoverPhoto siteId={s.id} path={s.cover_photo_path} canEdit={!deleted} />
          </>
        )}
      </section>

      <PropertyTickets jobs={d.jobs} counts={d.job_counts} />
      {seesOpportunitiesList(profile) && (
        <OpportunitiesSection
          opportunities={d.opportunities}
          page="property"
          emptyText="No opportunities at this property."
        />
      )}
      {can("estimate") && <PropertyBids bids={d.bids} />}
      <TasksSection
        accountId={d.account.id}
        accountName={d.account.name}
        site={{ id: s.id, name: s.name }}
        tasks={d.tasks}
        readOnly={deleted}
      />
      {/* Admins and managers: who changed the property, its sites and warranties (audit_log). */}
      <AuditHistory entity="site" entityId={id} className="rounded-lg border p-4" />
    </div>
  );
}

/** The tickets at the property, every stage, with the counts by stage in the header. */
function PropertyTickets({
  jobs,
  counts,
}: {
  jobs: PropertyDetail["jobs"];
  counts: PropertyDetail["job_counts"];
}) {
  const fold = useSectionFold("property", "tickets", jobs.length);
  return (
    <section className={sectionClass("tickets")} aria-label="Tickets">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Wrench}
        title="Tickets"
        summary={stageCountsLine(counts)}
      />
      {!fold.open ? null : jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service tickets at this property.</p>
      ) : (
        <TicketRows jobs={jobs} showSite={false} />
      )}
    </section>
  );
}

/**
 * The bids linked to the property, with their totals — mounted only with Estimate access (the
 * page gates it; getProperty sends none to anyone else). Linking and unlinking stay on the
 * customer's page.
 */
function PropertyBids({ bids }: { bids: LinkedBidRow[] }) {
  const fold = useSectionFold("property", "bids", bids.length);
  return (
    <section className={sectionClass("bids")} aria-label="Bids">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Link2}
        title="Bids"
        count={bids.length}
      />
      {!fold.open ? null : bids.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bids linked to this property. A bid is linked on its Setup tab or on the customer.
        </p>
      ) : (
        <div className={`divide-y rounded-md border ${INNER_BOX}`}>
          {bids.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <Link
                to="/estimate"
                search={{ bid: b.id }}
                className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline"
                title="Open this bid"
              >
                {b.name}
              </Link>
              <Badge variant="outline" className="px-1.5 py-0 text-[11px] capitalize">
                {b.status}
              </Badge>
              <span className="text-sm tabular-nums">{money(Number(b.grand_total) || 0)}</span>
              <span className="text-xs text-muted-foreground">{shortDate(b.updated_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
