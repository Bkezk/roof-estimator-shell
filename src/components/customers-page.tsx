/**
 * Customers — the CRM hub (docs/service-module-design.md §11). A customer is an account (a
 * company / group or an individual) with zero or more sites; service tickets and bids link to
 * it. A new customer is saved without sites; they are added on the account (Sites › Add site).
 * Each account has an account manager (the list filters by it), a physical and a mailing
 * address, and at least one of email / cell phone / office phone (owner, Sep 30). The list is
 * one full-width card per customer (owner, Oct 14: "each customer take up the length of the
 * screen and have relevant info shown on each card") — name, address, contact, account manager,
 * properties, tickets in progress; a click opens the customer's own page, /customers/<uuid>
 * (CustomerPage): the account's fields, its sites, its tickets and (with Estimate access) its
 * bids, with "All customers" back to the list. The old `?id=` address redirects there.
 *
 * The account and its sites open read-only; Edit switches a block to its form, Cancel puts it
 * back (owner, Sep 27). A new customer is offered the saved bids that look like it
 * (LinkBidsDialog), and the account keeps offering them in "Bids that look like this customer".
 *
 * Two tabs under the title: Customers (the above) and Vendors (`?tab=vendors`; owner, Oct 1:
 * "We need somewhere to add vendor info like name, address etc, then we can select them as a
 * recipient" — a tab here, not a sidebar entry: the owner wants fewer nav items). The Vendors
 * tab is vendors-section.tsx.
 *
 * A deleted customer still opens by id (an old `?id=` link, a ticket's customer chip): a
 * "Deleted on <date> by <who>" banner, and everything read-only — no New ticket, Edit, Delete,
 * site, contact or bid-link actions (the server refuses them too). Admins and managers get
 * Restore (restoreAccount), which brings back the sites and contacts deleted with it.
 *
 * Every section of the customer's page folds under its header (owner, Oct 15: "lets make these
 * collapsible so if there's 100 tickets it won't take up the whole page"): Properties open, the
 * rest open while short and folded past ten rows, each fold remembered per user
 * (lib/customer-folds.ts, components/section-fold.tsx). A property's name opens its own page,
 * /properties/<uuid> (property-page.tsx), with its tickets, sites and warranties.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Contact,
  FileText,
  Link2,
  ListTodo,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Sparkles,
  Target,
  Trash2,
  Truck,
  Unlink,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { dispatchesTickets, seesEveryone, seesOpportunitiesList } from "@/lib/access";
import { asBidStatus, STATUS_LABELS as BID_STATUS_LABELS } from "@/lib/bid-status";
import { OPP_STATUS_LABELS, type OppStatus } from "@/lib/opportunities.functions";
import { AuditHistory } from "@/components/audit-history";
import { DocumentsList } from "@/components/documents/documents-panel";
import { FoldHeader } from "@/components/section-fold";
import { INNER_BOX, sectionClass } from "@/lib/section-tints";
import { useSectionFold } from "@/lib/use-section-fold";
import { TicketRows } from "@/components/crm/ticket-rows";
import { countBy } from "@/lib/paging";
import { doneStamp, orderAccountTasks, type TaskRow } from "@/lib/tasks";
import { toldSuffix } from "@/lib/mentions";
import { TaskDialog } from "@/components/tasks/task-dialog";
import {
  deleteAccount,
  deleteContact,
  deleteSite,
  getAccount,
  linkBidToAccount,
  listAccounts,
  listContacts,
  listUnlinkedBids,
  restoreAccount,
  saveAccount,
  saveContact,
  siteAddressLine,
  suggestBidsForAccount,
  type AccountDetail,
  type AccountListRow,
  type AccountRow,
  type ContactWithSites,
  type LinkedBidRow,
  type SiteRow,
} from "@/lib/crm.functions";
import {
  CONTACT_REQUIRED,
  NO_CONTACT_ON_FILE,
  CRM_MAX,
  addressLines,
  deletedLine,
  hasContactMethod,
  mailingLines,
  matchesManager,
  type ManagerFilter,
} from "@/lib/crm-account";
import { SERVICE_STAGES, STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import { listAccountTakeoffs } from "@/lib/takeoff.functions";
import { QuickAddCustomerDialog } from "@/components/crm/account-picker";
import { CountyCodeLine } from "@/components/crm/county-code-picker";
import { SiteWarranties } from "@/components/crm/site-warranties";
import { PropertySites, SiteCoverPhoto } from "@/components/crm/property-sites";
import { SiteForm } from "@/components/crm/site-form";
import {
  AccountManagerSelect,
  AddressInputs,
  MailingAddressInputs,
  type AddressValue,
} from "@/components/crm/account-fields";
import { useCrmUsers } from "@/lib/use-crm-users";
import { OfferBidLinks, type OfferAccount } from "@/components/crm/link-bids-dialog";
import { VendorsSection } from "@/components/crm/vendors-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MENTION_HINT, MentionTextarea } from "@/components/mention-textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const day = (ymd: string | null) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const stageLabel = (s: string) =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? STAGE_LABELS[s as ServiceStage] : s;

/** The Customers page's tabs (`?tab=`): Customers (no param) and Vendors. */
const CUSTOMERS_TABS = [
  { tab: undefined, title: "Customers", icon: Contact },
  { tab: "vendors", title: "Vendors", icon: Truck },
] as const;
export type CustomersTab = "vendors";

function CustomersTabs({ tab }: { tab?: CustomersTab | undefined }) {
  return (
    <nav aria-label="Customers views" className="flex flex-wrap gap-1 border-b">
      {CUSTOMERS_TABS.map((t) => {
        const active = t.tab === tab;
        return (
          <Link
            key={t.title}
            to="/customers"
            search={t.tab ? { tab: t.tab } : {}}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.title}
          </Link>
        );
      })}
    </nav>
  );
}

export function CustomersPage({ tab }: { tab?: CustomersTab | undefined }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  // A customer just added, offered the saved bids that look like it.
  const [offerFor, setOfferFor] = useState<OfferAccount | null>(null);
  if (tab === "vendors")
    return (
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Contact className="h-6 w-6" /> Customers
          </h1>
          <p className="text-sm text-muted-foreground">
            Vendors: the suppliers we buy from, and bill when an invoice goes to a vendor.
          </p>
        </div>
        <CustomersTabs tab={tab} />
        <VendorsSection />
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Contact className="h-6 w-6" /> Customers
          </h1>
          <p className="text-sm text-muted-foreground">
            Companies and individuals, their properties, and the tickets and bids linked to them.
          </p>
        </div>
        <Button size="lg" className="text-base font-semibold" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-5 w-5" /> New customer
        </Button>
      </div>

      <CustomersTabs tab={tab} />

      {/* The counts strip (tickets in progress, overdue tickets, open / overdue opportunities)
          left this page on Oct 14 (owner): the list is the page. */}
      <AccountList />

      <QuickAddCustomerDialog
        open={adding}
        initialName=""
        onOpenChange={setAdding}
        onCreated={(hit) => {
          setAdding(false);
          void navigate({ to: "/customers/$id", params: { id: hit.account_id } });
          setOfferFor({ id: hit.account_id, name: hit.account_name });
        }}
      />
      <OfferBidLinks account={offerFor} onDone={() => setOfferFor(null)} />
    </div>
  );
}

/**
 * "No contact info" (owner, Oct 13): a live customer with no email, cell phone or office phone —
 * the ones the CenterPoint import brought over without any (crm_accounts_contact_required lets
 * source 'import' through) — in the list row and the customer header, muted, so the office
 * fills one in.
 */
function NoContactInfoBadge() {
  return (
    <Badge
      variant="outline"
      className="px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
      data-badge="no-contact-info"
    >
      No contact info
    </Badge>
  );
}

/**
 * One customer in the list (owner, Oct 14): a full-width card — name and kind, the street
 * address, the contact and how to reach them, the account manager, the properties and the
 * tickets in progress — that opens the customer's own page.
 */
function AccountCard({ a, managerName }: { a: AccountListRow; managerName: string | undefined }) {
  const address = [a.address1, [a.city, a.state].filter(Boolean).join(", "), a.zip]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to="/customers/$id"
      params={{ id: a.id }}
      className="block rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
      data-customer-card={a.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {a.kind === "individual" ? (
              <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 break-words text-base font-semibold sm:truncate">
              {a.name}
            </span>
            <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
              {a.kind === "individual" ? "Individual" : "Company"}
            </Badge>
            {/* Owner, Oct 13: a customer imported from CenterPoint may have no email or phone;
                the badge asks the office to fill one in (NoContactInfoBadge). */}
            {!a.deleted_at && !hasContactMethod(a) && <NoContactInfoBadge />}
            {a.external_id && (
              <span className="text-xs text-muted-foreground">#{a.external_id}</span>
            )}
          </div>
          {address && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {address}
            </p>
          )}
          {(a.contact_name || a.mobile || a.phone || a.email) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {a.contact_name && <span className="text-foreground">{a.contact_name}</span>}
              {(a.mobile || a.phone) && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {a.mobile || a.phone}
                  {a.mobile && a.phone ? ` · ${a.phone}` : ""}
                </span>
              )}
              {a.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /> {a.email}
                </span>
              )}
            </p>
          )}
        </div>
        {/* On a phone the three stats take the full width under the name (owner, Oct 26: beside
            it they squeezed the name to a few letters); from sm up they sit to the right. */}
        <dl className="grid w-full grid-cols-3 gap-x-3 text-sm sm:w-auto sm:shrink-0 sm:gap-x-6 sm:text-right">
          <div>
            <dt className="text-xs text-muted-foreground">Account manager</dt>
            <dd>{managerName ?? "Unassigned"}</dd>
          </div>
          <div>
            {/* "Property" since Oct 6 (owner, Oct 7: the list still said "2 sites"). */}
            <dt className="text-xs text-muted-foreground">Properties</dt>
            <dd>{a.site_count}</dd>
          </div>
          <div>
            {/* Open, Scheduled, Done or Authorized — not yet invoiced or closed (owner, Oct 12,
                item 6: the "Tickets in progress" set). */}
            <dt className="text-xs text-muted-foreground">Tickets in progress</dt>
            <dd className={a.open_jobs ? "font-medium" : ""}>{a.open_jobs}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}

/**
 * A customer's own page, /customers/<uuid> (owner, Oct 14): the detail pane full width under
 * the title, with "All customers" back to the list.
 */
export function CustomerPage({ id }: { id: string }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Contact className="h-6 w-6" /> Customer
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/customers">
            <ArrowLeft className="mr-1 h-4 w-4" /> All customers
          </Link>
        </Button>
      </div>
      <AccountDetailPane id={id} />
    </div>
  );
}

function AccountList() {
  const { session } = useAuth();
  const listFn = useServerFn(listAccounts);
  const list = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const users = useCrmUsers();
  const userName = new Map((users.data ?? []).map((u) => [u.id, u.name]));
  const [search, setSearch] = useState("");
  const [manager, setManager] = useState<ManagerFilter>("all");
  const q = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (a) =>
      matchesManager(a, manager) &&
      (!q ||
        [a.name, a.city, a.contact_name, a.external_id, a.phone, a.mobile, a.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Search name, city, contact, customer #…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Select value={manager} onValueChange={(v) => setManager(v)}>
        <SelectTrigger aria-label="Filter by account manager">
          <SelectValue placeholder="Filter by account manager" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All account managers</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {(users.data ?? []).map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {users.error && (
        <p className="text-xs text-destructive">
          Could not load the account managers: {errText(users.error)}
        </p>
      )}
      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load customers ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading customers…
        </p>
      ) : list.data.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No customers yet. Add one with New customer, or from a ticket&apos;s customer search.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q ? `No customer matches “${search.trim()}”` : "No customer matches"}
          {manager === "all"
            ? "."
            : manager === "unassigned"
              ? " without an account manager."
              : ` for ${userName.get(manager) ?? "that account manager"}.`}
        </p>
      ) : (
        <div className="space-y-2" data-list="customers">
          {rows.map((a) => (
            <AccountCard key={a.id} a={a} managerName={userName.get(a.account_manager_id ?? "")} />
          ))}
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length} of {list.data.length} customer{list.data.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

function AccountDetailPane({ id }: { id: string }) {
  const { session, can, profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getAccount);
  const deleteFn = useServerFn(deleteAccount);
  const restoreFn = useServerFn(restoreAccount);
  const detail = useQuery({
    queryKey: ["account", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Customer deleted");
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["account-search"] });
      void navigate({ to: "/customers" });
    },
    onError: (e) => toast.error(`Could not delete the customer: ${errText(e)}`),
  });
  const restore = useMutation({
    mutationFn: () => restoreFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Customer restored");
      void qc.invalidateQueries({ queryKey: ["account", id] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["account-search"] });
      void qc.invalidateQueries({ queryKey: ["contacts", id] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (e) => toast.error(`Could not restore the customer: ${errText(e)}`),
  });

  if (detail.error)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          Could not open the customer: {errText(detail.error)}
        </p>
      </div>
    );
  if (!detail.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the customer…
      </p>
    );
  const d = detail.data;
  // Deleted (an old link, a ticket's customer chip): read-only, Restore for admins / managers.
  const deleted = !!d.account.deleted_at;
  const canRestore = seesEveryone(profile);
  return (
    <div className="space-y-6">
      {d.account.deleted_at && (
        <div
          role="status"
          data-banner="deleted"
          className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          <Trash2 className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{deletedLine(d.account.deleted_at, d.deleted_by)}.</span>{" "}
            It is out of the list and the searches, with its properties and contacts, and read-only.
            {canRestore ? "" : " An admin or a manager can restore it."}
          </span>
          {canRestore && (
            <Button
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Restore
            </Button>
          )}
        </div>
      )}
      <AccountBlock
        account={d.account}
        readOnly={deleted}
        onDelete={() => setConfirmDelete(true)}
      />
      <ContactsSection accountId={id} sites={d.sites} readOnly={deleted} />
      <SitesSection accountId={id} sites={d.sites} jobs={d.jobs} readOnly={deleted} />
      <TicketsSection jobs={d.jobs} />
      {/* Owner, Oct 12: the customer's opportunities, for those who see the Opportunities list
          (Customers / Estimate; the same people who read them). */}
      {seesOpportunitiesList(profile) && <OpportunitiesSection opportunities={d.opportunities} />}
      {can("estimate") && <BidsSection accountId={id} bids={d.bids} readOnly={deleted} />}
      <TasksSection
        accountId={id}
        accountName={d.account.name}
        tasks={d.tasks}
        readOnly={deleted}
      />
      {can("takeoff") && <TakeoffsSection accountId={id} />}
      {/* Documents (owner, Oct 26): every proposal, report and letter ever made for this customer,
          across its bids and tickets, with the record each one is for. */}
      <DocumentsSection accountId={id} />
      {/* Admins and managers: who changed the customer, its sites and contacts (audit_log). */}
      <AuditHistory entity="account" entityId={id} className="rounded-lg border p-4" />

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!remove.isPending) setConfirmDelete(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{d.account.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer disappears from the list and the searches, with its properties and
              contacts. Its tickets and bids keep the customer name they were saved with. A customer
              with open tickets or open opportunities cannot be deleted. An admin or a manager can
              restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type AccountFields = {
  name: string;
  kind: "company" | "individual";
  contact_name: string;
  /** Office phone. */
  phone: string;
  /** Cell phone. */
  mobile: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  mailing_same: boolean;
  mailing_address1: string;
  mailing_address2: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  /** "" = unassigned. */
  account_manager_id: string;
  billing_instructions: string;
  external_id: string;
  notes: string;
};
const accountFields = (a: AccountRow): AccountFields => ({
  name: a.name,
  kind: a.kind === "individual" ? "individual" : "company",
  contact_name: a.contact_name ?? "",
  phone: a.phone ?? "",
  mobile: a.mobile ?? "",
  email: a.email ?? "",
  address1: a.address1 ?? "",
  address2: a.address2 ?? "",
  city: a.city ?? "",
  state: a.state ?? "",
  zip: a.zip ?? "",
  mailing_same: a.mailing_same,
  mailing_address1: a.mailing_address1 ?? "",
  mailing_address2: a.mailing_address2 ?? "",
  mailing_city: a.mailing_city ?? "",
  mailing_state: a.mailing_state ?? "",
  mailing_zip: a.mailing_zip ?? "",
  account_manager_id: a.account_manager_id ?? "",
  billing_instructions: a.billing_instructions ?? "",
  external_id: a.external_id ?? "",
  notes: a.notes ?? "",
});

/**
 * The account's fields: a read-only summary, or (after Edit) the form. A deleted customer
 * (`readOnly`) has the summary only, without Edit / Delete / New ticket.
 */
function AccountBlock({
  account,
  readOnly,
  onDelete,
}: {
  account: AccountRow;
  readOnly: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !readOnly)
    return <AccountForm account={account} onDone={() => setEditing(false)} />;
  return (
    <AccountSummary
      account={account}
      readOnly={readOnly}
      onEdit={() => setEditing(true)}
      onDelete={onDelete}
    />
  );
}

function AccountSummary(props: {
  account: AccountRow;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { can, profile } = useAuth();
  // Only a manager creates tickets (owner, Oct 1).
  // Owner, Oct 9: the office creates tickets too (dispatchesTickets), here as on the Service page.
  const canNewTicket = can("service") && dispatchesTickets(profile) && !props.readOnly;
  const users = useCrmUsers();
  const a = props.account;
  const physical = addressLines(a);
  const mailing = mailingLines(a);
  const manager = a.account_manager_id
    ? (users.data?.find((u) => u.id === a.account_manager_id)?.name ??
      (users.isLoading ? "…" : "(a removed user)"))
    : null;
  const lines = (ls: string[]) =>
    ls.length ? (
      <>
        {ls.map((l) => (
          <span key={l} className="block">
            {l}
          </span>
        ))}
      </>
    ) : null;
  const tel = (n: string | null) =>
    n ? (
      <a href={`tel:${n}`} className="underline-offset-2 hover:underline">
        {n}
      </a>
    ) : null;
  const none = <span className="text-muted-foreground">—</span>;
  const row = (label: string, value: React.ReactNode, wide?: boolean) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value ?? none}</dd>
    </div>
  );
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="Customer">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <span className="min-w-0 truncate">{a.name}</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
              {a.kind === "individual" ? "Individual" : "Company"}
            </Badge>
            {!a.deleted_at && !hasContactMethod(a) && <NoContactInfoBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            Updated {shortDate(a.updated_at)}
            {a.updated_by_name ? ` by ${a.updated_by_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canNewTicket && (
            <Button asChild size="sm">
              <Link to="/service" search={{ new: 1, account: a.id }}>
                <Plus className="mr-1 h-4 w-4" /> New ticket
              </Link>
            </Button>
          )}
          {!props.readOnly && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={props.onEdit}>
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={props.onDelete}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete customer
              </Button>
            </>
          )}
        </div>
      </div>
      {!a.deleted_at && !hasContactMethod(a) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {NO_CONTACT_ON_FILE}
        </p>
      )}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {row("Account manager", manager ?? "Unassigned")}
        {row("Contact", a.contact_name)}
        {row("Cell phone", tel(a.mobile))}
        {row("Office phone", tel(a.phone))}
        {row(
          "Email",
          a.email ? (
            <a href={`mailto:${a.email}`} className="break-all underline-offset-2 hover:underline">
              {a.email}
            </a>
          ) : null,
        )}
        {row("Physical address", lines(physical))}
        {row(
          "Mailing address",
          a.mailing_same ? (
            physical.length ? (
              <>
                {lines(physical)}
                <span className="block text-xs text-muted-foreground">Same as physical</span>
              </>
            ) : (
              <span className="text-muted-foreground">Same as physical</span>
            )
          ) : (
            lines(mailing)
          ),
        )}
        {row(
          "Billing instructions",
          a.billing_instructions ? (
            <span className="whitespace-pre-line">{a.billing_instructions}</span>
          ) : null,
          true,
        )}
        {row("Sage / CenterPoint customer #", a.external_id)}
        {row(
          "Notes",
          a.notes ? <span className="whitespace-pre-line">{a.notes}</span> : null,
          true,
        )}
      </dl>
    </section>
  );
}

function AccountForm({ account, onDone }: { account: AccountRow; onDone: () => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveAccount);
  const [f, setF] = useState<AccountFields>(() => accountFields(account));
  const dirty = JSON.stringify(f) !== JSON.stringify(accountFields(account));
  const set = <K extends keyof AccountFields>(k: K, v: AccountFields[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const reachable = hasContactMethod(f);
  const [tried, setTried] = useState(false);
  const mailing: AddressValue = {
    address1: f.mailing_address1,
    address2: f.mailing_address2,
    city: f.mailing_city,
    state: f.mailing_state,
    zip: f.mailing_zip,
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: account.id,
          ...f,
          account_manager_id: f.account_manager_id || null,
        },
      }),
    onSuccess: ({ mentioned, mention_error, ...row }) => {
      toast.success(`Customer saved${toldSuffix(mentioned)}`);
      // The customer is saved; say loudly when the people named in Notes were not told.
      if (mention_error) toast.error(mention_error, { duration: 12_000 });
      qc.setQueryData<AccountDetail>(["account", row.id], (old) =>
        old ? { ...old, account: row } : old,
      );
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["account-search"] });
      // A new name may match other saved bids.
      void qc.invalidateQueries({ queryKey: ["bid-suggestions", row.id] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      onDone();
    },
    onError: (e) => toast.error(`Could not save the customer: ${errText(e)}`),
  });

  const field = (
    k: Exclude<keyof AccountFields, "mailing_same" | "kind">,
    label: string,
    props?: { type?: string },
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`acct-${k}`}>{label}</Label>
      <Input
        id={`acct-${k}`}
        type={props?.type ?? "text"}
        maxLength={(CRM_MAX as Record<string, number>)[k]}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

  return (
    <form
      className="space-y-4 rounded-lg border border-primary/40 p-4"
      aria-label="Edit customer"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!f.name.trim()) {
          toast.error("The customer needs a name");
          return;
        }
        if (!reachable) {
          toast.error(CONTACT_REQUIRED);
          return;
        }
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">Edit {account.name}</h2>
          <p className="text-xs text-muted-foreground">
            Updated {shortDate(account.updated_at)}
            {account.updated_by_name ? ` by ${account.updated_by_name}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="acct-name">Name</Label>
          <Input
            id="acct-name"
            maxLength={CRM_MAX.name}
            autoFocus
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Kind</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={f.kind}
            onValueChange={(v) => {
              if (v === "company" || v === "individual") set("kind", v);
            }}
          >
            <ToggleGroupItem value="company">Company</ToggleGroupItem>
            <ToggleGroupItem value="individual">Individual</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("contact_name", "Contact")}
        <AccountManagerSelect
          id="acct-manager"
          value={f.account_manager_id}
          onChange={(v) => set("account_manager_id", v)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {field("email", "Email", { type: "email" })}
        {field("mobile", "Cell phone", { type: "tel" })}
        {field("phone", "Office phone", { type: "tel" })}
      </div>
      {tried && !reachable ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {CONTACT_REQUIRED}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          At least one of email, cell phone or office phone is required.
        </p>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Physical address</p>
        <AddressInputs
          label="Physical address"
          value={{
            address1: f.address1,
            address2: f.address2,
            city: f.city,
            state: f.state,
            zip: f.zip,
          }}
          onChange={(k, v) => set(k, v)}
        />
      </div>
      <MailingAddressInputs
        idPrefix="acct"
        same={f.mailing_same}
        onSame={(v) => set("mailing_same", v)}
        value={mailing}
        onChange={(k, v) => set(`mailing_${k}`, v)}
      />
      <div className="space-y-1">
        <Label htmlFor="acct-billing">Billing instructions</Label>
        <Textarea
          id="acct-billing"
          rows={2}
          maxLength={CRM_MAX.billing_instructions}
          placeholder="e.g. Need a PO on the invoice; call the BOE office first"
          value={f.billing_instructions}
          onChange={(e) => set("billing_instructions", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Shown under PO # on a new ticket.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        {field("external_id", "Sage / CenterPoint customer #")}
        <div className="space-y-1">
          <Label htmlFor="acct-notes">Notes</Label>
          <MentionTextarea
            id="acct-notes"
            rows={2}
            maxLength={CRM_MAX.notes}
            value={f.notes}
            placeholder={`Anything the next person should know — ${MENTION_HINT}`}
            onValueChange={(v) => set("notes", v)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onDone}>
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
        {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
      </div>
    </form>
  );
}

// ---- Contacts ----------------------------------------------------------------------------------
// People at the account (phase B). A contact belongs to the whole account ("All sites") or to
// the sites ticked; Billing marks who gets the invoices. The ticket's site contact is picked from
// these.

type ContactFields = {
  name: string;
  position: string;
  email: string;
  mobile: string;
  office_phone: string;
  is_billing: boolean;
  notes: string;
  site_ids: string[];
};
const contactFields = (c: ContactWithSites | null): ContactFields => ({
  name: c?.name ?? "",
  position: c?.position ?? "",
  email: c?.email ?? "",
  mobile: c?.mobile ?? "",
  office_phone: c?.office_phone ?? "",
  is_billing: c?.is_billing ?? false,
  notes: c?.notes ?? "",
  site_ids: c?.site_ids ?? [],
});
/** "tel:" wants the digits (and a leading +), not the formatting. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function ContactsSection({
  accountId,
  sites,
  readOnly,
}: {
  accountId: string;
  sites: SiteRow[];
  /** A deleted customer: the contacts are listed, no Add / Edit / Delete. */
  readOnly: boolean;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listContacts);
  const deleteFn = useServerFn(deleteContact);
  const contacts = useQuery({
    queryKey: ["contacts", accountId],
    queryFn: () => listFn({ data: { account_id: accountId } }),
    enabled: !!session,
  });
  // "new" = the add form is open; an id = that contact is being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ContactWithSites | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["contacts", accountId] });
    void qc.invalidateQueries({ queryKey: ["account", accountId] });
    void qc.invalidateQueries({ queryKey: ["account-search"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Contact deleted");
      setToDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the contact: ${errText(e)}`),
  });
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const siteList = (ids: string[]) => {
    if (ids.length === 0) return "All properties";
    const names = ids.flatMap((sid) => siteName.get(sid) ?? []);
    return names.length ? names.join(", ") : "A deleted property";
  };
  const rows = contacts.data ?? [];
  const fold = useSectionFold("customer", "contacts", contacts.data ? rows.length : null);

  return (
    <section className={sectionClass("contacts")} aria-label="Contacts">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Users}
        title="Contacts"
        count={contacts.data ? rows.length : null}
      >
        {!readOnly && editing !== "new" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing("new");
              if (!fold.open) fold.toggle();
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add contact
          </Button>
        )}
      </FoldHeader>
      {fold.open && contacts.error ? (
        <p className="text-sm text-destructive">
          Could not load the contacts: {errText(contacts.error)}
        </p>
      ) : fold.open && contacts.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
        </p>
      ) : (
        fold.open &&
        rows.length === 0 &&
        editing !== "new" && (
          <p className="text-sm text-muted-foreground">
            No contacts yet. Add the people you call: the property contact, who approves work, who
            gets the invoice.
          </p>
        )
      )}
      <div className="space-y-2" hidden={!fold.open}>
        {rows.map((c) =>
          !readOnly && editing === c.id ? (
            <ContactForm
              key={c.id}
              accountId={accountId}
              contact={c}
              sites={sites}
              onDone={(changed) => {
                setEditing(null);
                if (changed) refresh();
              }}
            />
          ) : (
            <div
              key={c.id}
              className={`flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 ${INNER_BOX}`}
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.position && (
                    <span className="text-sm text-muted-foreground">{c.position}</span>
                  )}
                  {c.is_billing && (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                      Billing
                    </Badge>
                  )}
                </p>
                {(c.mobile || c.office_phone || c.email) && (
                  <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                    {c.mobile && (
                      <a
                        href={telHref(c.mobile)}
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" /> {c.mobile}
                        <span className="text-xs text-muted-foreground">mobile</span>
                      </a>
                    )}
                    {c.office_phone && (
                      <a
                        href={telHref(c.office_phone)}
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" /> {c.office_phone}
                        <span className="text-xs text-muted-foreground">office</span>
                      </a>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex min-w-0 items-center gap-1 break-all text-primary underline-offset-2 hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" /> {c.email}
                      </a>
                    )}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  <MapPin className="mr-1 inline h-3 w-3" />
                  {siteList(c.site_ids)}
                </p>
                {c.notes && <p className="whitespace-pre-line text-xs">{c.notes}</p>}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Edit this contact"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => setEditing(c.id)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    title="Delete this contact"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => setToDelete(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ),
        )}
        {!readOnly && editing === "new" && (
          <ContactForm
            accountId={accountId}
            contact={null}
            sites={sites}
            onDone={(changed) => {
              setEditing(null);
              if (changed) refresh();
            }}
          />
        )}
      </div>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the contact “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              They disappear from this customer and from the property contact choices on tickets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ContactForm(props: {
  accountId: string;
  contact: ContactWithSites | null;
  sites: SiteRow[];
  onDone: (changed: boolean) => void;
}) {
  const saveFn = useServerFn(saveContact);
  const [f, setF] = useState<ContactFields>(() => contactFields(props.contact));
  const set = <K extends keyof ContactFields>(k: K, v: ContactFields[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const toggleSite = (id: string, on: boolean) =>
    setF((p) => ({
      ...p,
      site_ids: on
        ? [...p.site_ids.filter((x) => x !== id), id]
        : p.site_ids.filter((x) => x !== id),
    }));
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(props.contact ? { id: props.contact.id } : {}),
          account_id: props.accountId,
          name: f.name,
          position: f.position,
          email: f.email,
          mobile: f.mobile,
          office_phone: f.office_phone,
          is_billing: f.is_billing,
          notes: f.notes,
          // Only sites that still exist on the account (a deleted site's link is dropped).
          site_ids: f.site_ids.filter((id) => props.sites.some((s) => s.id === id)),
        },
      }),
    onSuccess: () => {
      toast.success(props.contact ? "Contact saved" : "Contact added");
      props.onDone(true);
    },
    onError: (e) => toast.error(`Could not save the contact: ${errText(e)}`),
  });
  const idp = props.contact?.id ?? "new";
  return (
    <form
      className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) {
          toast.error("The contact needs a name");
          return;
        }
        save.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`contact-${idp}-name`}>Name</Label>
          <Input
            id={`contact-${idp}-name`}
            maxLength={CRM_MAX.name}
            autoFocus
            value={f.name}
            placeholder="e.g. Pat Miller"
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`contact-${idp}-position`}>Position</Label>
          <Input
            id={`contact-${idp}-position`}
            maxLength={CRM_MAX.position}
            value={f.position}
            placeholder="e.g. Facilities manager"
            onChange={(e) => set("position", e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`contact-${idp}-mobile`}>Mobile</Label>
          <Input
            id={`contact-${idp}-mobile`}
            maxLength={CRM_MAX.mobile}
            type="tel"
            inputMode="tel"
            value={f.mobile}
            onChange={(e) => set("mobile", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`contact-${idp}-office`}>Office phone</Label>
          <Input
            id={`contact-${idp}-office`}
            maxLength={CRM_MAX.office_phone}
            type="tel"
            inputMode="tel"
            value={f.office_phone}
            onChange={(e) => set("office_phone", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`contact-${idp}-email`}>Email</Label>
          <Input
            id={`contact-${idp}-email`}
            maxLength={CRM_MAX.email}
            type="email"
            inputMode="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`contact-${idp}-billing`}
          checked={f.is_billing}
          onCheckedChange={(v) => set("is_billing", v)}
        />
        <Label htmlFor={`contact-${idp}-billing`} className="font-normal">
          Billing contact (gets the invoices)
        </Label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Properties</legend>
        {props.sites.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This customer has no properties yet; the contact covers the whole account.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Tick the properties they are the contact for; none ticked = all properties.
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {props.sites.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={f.site_ids.includes(s.id)}
                    onCheckedChange={(v) => toggleSite(s.id, v === true)}
                  />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor={`contact-${idp}-notes`}>Notes</Label>
        <Textarea
          id={`contact-${idp}-notes`}
          maxLength={CRM_MAX.contact_notes}
          rows={2}
          value={f.notes}
          placeholder="e.g. Text before calling; off Fridays"
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {props.contact ? "Save contact" : "Add contact"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={save.isPending}
          onClick={() => props.onDone(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SitesSection({
  accountId,
  sites,
  jobs,
  readOnly,
}: {
  accountId: string;
  sites: SiteRow[];
  /** The customer's tickets: each property card counts its own (by site_id). */
  jobs: AccountDetail["jobs"];
  /** A deleted customer: the sites are listed, no Add / New ticket / Edit / Delete. */
  readOnly: boolean;
}) {
  const { can, profile } = useAuth();
  const fold = useSectionFold("customer", "properties", sites.length);
  const ticketCounts = countBy(jobs, (j) => j.site_id);
  // Only a manager creates tickets (owner, Oct 1).
  const canNewTicket = can("service") && dispatchesTickets(profile) && !readOnly;
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteSite);
  // "new" = the add form is open; an id = that site is being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SiteRow | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["account", accountId] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
    void qc.invalidateQueries({ queryKey: ["account-search"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Property deleted");
      setToDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the property: ${errText(e)}`),
  });

  return (
    <section className={sectionClass("properties")} aria-label="Properties">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={MapPin}
        title="Properties"
        count={sites.length}
      >
        {!readOnly && editing !== "new" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing("new");
              if (!fold.open) fold.toggle();
            }}
          >
            {/* "Property" since Oct 6 (owner, Oct 6): the inner Sites are the site form's. */}
            <Plus className="mr-1 h-4 w-4" /> Add property
          </Button>
        )}
      </FoldHeader>
      {fold.open && sites.length === 0 && editing !== "new" && (
        <p className="text-sm text-muted-foreground">
          No properties yet. A property is a building or address the work happens at.
        </p>
      )}
      <div className="space-y-2" hidden={!fold.open}>
        {sites.map((s) =>
          !readOnly && editing === s.id ? (
            <SiteForm
              key={s.id}
              accountId={accountId}
              site={s}
              onDone={(changed) => {
                setEditing(null);
                if (changed) refresh();
              }}
            />
          ) : (
            <div
              key={s.id}
              className={`flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 ${INNER_BOX}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  {/* Oct 15: the property's own page — its details, tickets, sites. */}
                  <Link
                    to="/properties/$id"
                    params={{ id: s.id }}
                    className="font-medium underline-offset-2 hover:underline"
                    title="Open this property"
                  >
                    {s.name}
                  </Link>
                  <span className="text-xs text-muted-foreground" data-site-tickets={s.id}>
                    {ticketCounts.get(s.id) ?? 0} ticket{ticketCounts.get(s.id) === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {siteAddressLine(s) || "No address on file"}
                </p>
                <CountyCodeLine id={s.county_code_id} className="mt-1 text-xs" />
                {s.technician_instructions && (
                  <p className="mt-1 whitespace-pre-line text-xs">
                    <span className="font-medium">Technician instructions: </span>
                    {s.technician_instructions}
                  </p>
                )}
                {s.notes && (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    <span className="font-medium">Notes: </span>
                    {s.notes}
                  </p>
                )}
                {/* M5 (owner, Oct 5): the roof warranties; their badge shows on the tickets. */}
                <SiteWarranties siteId={s.id} />
                {/* Owner, Oct 6: the named sites inside the property (a ticket picks one). */}
                <PropertySites propertyId={s.id} />
                {/* Phase 2 of the documents (Oct 26): the cover photo a document's cover page prints. */}
                <SiteCoverPhoto siteId={s.id} path={s.cover_photo_path} canEdit={!readOnly} />
              </div>
              <div className="flex items-center gap-1">
                {canNewTicket && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    title="New service ticket at this property"
                  >
                    <Link to="/service" search={{ new: 1, account: accountId, site: s.id }}>
                      <Wrench className="mr-1 h-4 w-4" /> New ticket
                    </Link>
                  </Button>
                )}
                {!readOnly && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Edit this property"
                      aria-label={`Edit ${s.name}`}
                      onClick={() => setEditing(s.id)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      title="Delete this property"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => setToDelete(s)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ),
        )}
        {!readOnly && editing === "new" && (
          <SiteForm
            accountId={accountId}
            site={null}
            onDone={(changed) => {
              setEditing(null);
              if (changed) refresh();
            }}
          />
        )}
      </div>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the property “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Tickets at this property keep the property name and address they were saved with.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function TicketsSection({ jobs }: { jobs: AccountDetail["jobs"] }) {
  const fold = useSectionFold("customer", "tickets", jobs.length);
  return (
    <section className={sectionClass("tickets")} aria-label="Tickets">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Wrench}
        title="Tickets"
        count={jobs.length}
      />
      {!fold.open ? null : jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service tickets for this customer.</p>
      ) : (
        <TicketRows jobs={jobs} />
      )}
    </section>
  );
}

/**
 * The customer's opportunities (owner, Oct 12): live open ones first, then closed ones (Won /
 * Lost / No response) folded under "Closed", deleted ones last in that fold. Each row — title,
 * status, assignee, expected close, the linked bid's status — opens the opportunity.
 */
export function OpportunitiesSection({
  opportunities,
  page = "customer",
  emptyText = "No opportunities for this customer.",
}: {
  opportunities: AccountDetail["opportunities"];
  /** Whose folds to remember: the customer's page (default) or the property's. */
  page?: "customer" | "property";
  emptyText?: string;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const fold = useSectionFold(page, "opportunities", opportunities.length);
  const isClosed = (o: AccountDetail["opportunities"][number]) =>
    !!o.deleted_at || ["won", "lost", "no_response"].includes(o.status);
  const live = opportunities.filter((o) => !isClosed(o));
  const closed = opportunities.filter(isClosed);
  const label = (s: string) => OPP_STATUS_LABELS[s as OppStatus] ?? s;
  const row = (o: AccountDetail["opportunities"][number]) => (
    <Link
      key={o.id}
      to="/opportunities"
      search={{ id: o.id }}
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm hover:bg-muted/60"
      data-opportunity={o.id}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
      <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
        {o.deleted_at ? "Deleted" : label(o.status)}
      </Badge>
      {o.bid_id && (
        <Badge variant="outline" className="px-1.5 py-0 text-[11px]" data-chip="bid">
          Bid: {BID_STATUS_LABELS[asBidStatus(o.bid_status)]}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">
        {o.assignee_name ?? "Unassigned"}
        {o.expected_close ? ` · Expected close ${day(o.expected_close)}` : ""}
      </span>
    </Link>
  );
  return (
    <section className={sectionClass("opportunities")} aria-label="Opportunities">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Target}
        title="Opportunities"
        count={opportunities.length}
      />
      {!fold.open ? null : opportunities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          {live.length > 0 && (
            <div className={`divide-y rounded-md border ${INNER_BOX}`}>{live.map(row)}</div>
          )}
          {closed.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((v) => !v)}
              >
                {showClosed ? "Hide" : "Show"} {closed.length} closed
              </button>
              {showClosed && (
                <div className={`divide-y rounded-md border ${INNER_BOX}`}>{closed.map(row)}</div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The customer's tasks (owner, Oct 9: "add them to the work overview and lists with the same
 * behavior as services"): open ones first by due day, then done ones with their stamp ("Done
 * Oct 9, 2:15 PM by …"). A row opens the task dialog; New task starts one on this company.
 */
export function TasksSection({
  accountId,
  accountName,
  site,
  tasks,
  readOnly,
}: {
  accountId: string;
  accountName: string;
  /** On a property's page: New task starts on this property, and the folds are the page's. */
  site?: { id: string; name: string } | undefined;
  tasks: TaskRow[];
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ task?: TaskRow } | null>(null);
  const rows = orderAccountTasks(tasks);
  const fold = useSectionFold(site ? "property" : "customer", "tasks", rows.length);
  return (
    <section className={sectionClass("tasks")} aria-label="Tasks">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={ListTodo}
        title="Tasks"
        count={rows.length}
      >
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setDialog({})}>
            <Plus className="mr-1 h-4 w-4" /> New task
          </Button>
        )}
      </FoldHeader>
      {!fold.open ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tasks for this {site ? "property" : "customer"}.
        </p>
      ) : (
        <div className={`divide-y rounded-md border ${INNER_BOX}`}>
          {rows.map((t) => {
            const stamp = doneStamp(t);
            return (
              <button
                key={t.id}
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60"
                onClick={() => setDialog({ task: t })}
              >
                <span
                  className={`min-w-0 flex-1 truncate font-medium ${
                    stamp ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {t.title}
                  {t.site_name ? (
                    <span className="font-normal text-muted-foreground"> · {t.site_name}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.due_date ? day(t.due_date) : "No date"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.assignee_name ?? "Unassigned"}
                </span>
                <span className="text-xs text-muted-foreground">{stamp ?? "Open"}</span>
              </button>
            );
          })}
        </div>
      )}
      <TaskDialog
        open={!!dialog}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        task={dialog?.task}
        defaults={{
          account_id: accountId,
          account_name: accountName,
          site_id: site?.id ?? null,
          site_name: site?.name ?? null,
        }}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["account", accountId] });
          if (site) void qc.invalidateQueries({ queryKey: ["property", site.id] });
        }}
      />
    </section>
  );
}

/** The customer's takeoffs (their building plans): link on the takeoff's Setup tab. */
function TakeoffsSection({ accountId }: { accountId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listAccountTakeoffs);
  const list = useQuery({
    queryKey: ["account-takeoffs", accountId],
    queryFn: () => listFn({ data: { account_id: accountId } }),
    enabled: !!session,
  });
  const rows = list.data ?? [];
  const fold = useSectionFold("customer", "takeoffs", list.data ? rows.length : null);
  return (
    <section className={sectionClass("takeoffs")} aria-label="Takeoffs">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Ruler}
        title="Takeoffs"
        count={list.data ? rows.length : null}
      />
      {!fold.open ? null : list.error ? (
        <p className="text-sm text-destructive">
          Could not load the takeoffs: {errText(list.error)}
        </p>
      ) : !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No takeoffs linked to this customer. Link one from its Setup tab in Takeoff.
        </p>
      ) : (
        <div className={`divide-y rounded-md border ${INNER_BOX}`}>
          {rows.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <Link
                to="/takeoff"
                search={{ id: t.id }}
                className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline"
                title="Open this takeoff"
              >
                {t.name}
              </Link>
              <Badge variant="outline" className="px-1.5 py-0 text-[11px] capitalize">
                {t.status}
              </Badge>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t.page_count} page{t.page_count === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-muted-foreground">
                Updated {shortDate(t.updated_at)}
                {t.updated_by_name ? ` by ${t.updated_by_name}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BidsSection({
  accountId,
  bids,
  readOnly,
}: {
  accountId: string;
  bids: LinkedBidRow[];
  /** A deleted customer: the linked bids are listed, no Link / Unlink / suggestions. */
  readOnly: boolean;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const linkFn = useServerFn(linkBidToAccount);
  const unlinkedFn = useServerFn(listUnlinkedBids);
  const suggestFn = useServerFn(suggestBidsForAccount);
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const unlinked = useQuery({
    queryKey: ["unlinked-bids", debounced],
    queryFn: () => unlinkedFn({ data: { q: debounced } }),
    enabled: !!session && linking,
  });
  // Unlinked saved bids whose name or customer name looks like this account's.
  const suggested = useQuery({
    queryKey: ["bid-suggestions", accountId],
    queryFn: () => suggestFn({ data: { account_id: accountId } }),
    enabled: !!session && !readOnly,
  });
  const link = useMutation({
    mutationFn: (v: { bid: LinkedBidRow; accountId: string | null }) =>
      linkFn({ data: { bid_id: v.bid.id, account_id: v.accountId, site_id: null } }),
    onSuccess: (_r, v) => {
      toast.success(v.accountId ? `Linked “${v.bid.name}”` : `Unlinked “${v.bid.name}”`);
      void qc.invalidateQueries({ queryKey: ["account", accountId] });
      void qc.invalidateQueries({ queryKey: ["unlinked-bids"] });
      void qc.invalidateQueries({ queryKey: ["bid-suggestions"] });
      void qc.invalidateQueries({ queryKey: ["bids"] });
    },
    onError: (e) => toast.error(`Could not change the bid link: ${errText(e)}`),
  });

  const fold = useSectionFold("customer", "bids", bids.length);
  return (
    <section className={sectionClass("bids")} aria-label="Bids">
      <FoldHeader
        open={fold.open}
        onToggle={fold.toggle}
        icon={Link2}
        title="Bids"
        count={bids.length}
      >
        {!readOnly && !linking && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLinking(true);
              if (!fold.open) fold.toggle();
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Link a bid
          </Button>
        )}
      </FoldHeader>
      {fold.open && (
        <>
          {!readOnly && !!suggested.data?.length && (
            <div
              className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/40"
              aria-label="Bids that look like this customer"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Bids that look like this customer
              </p>
              <div className="divide-y rounded-md border bg-card">
                {suggested.data.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <Link
                      to="/estimate"
                      search={{ bid: b.id }}
                      className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline"
                      title="Open this bid"
                    >
                      {b.name}
                    </Link>
                    <Badge variant="outline" className="px-1.5 py-0 text-[11px] capitalize">
                      {b.status}
                    </Badge>
                    <span className="text-sm tabular-nums">
                      {money(Number(b.grand_total) || 0)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={link.isPending}
                      onClick={() => link.mutate({ bid: b, accountId })}
                    >
                      <Link2 className="mr-1 h-4 w-4" /> Link
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {bids.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bids linked to this customer.</p>
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
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Unlink this bid from the customer"
                      aria-label={`Unlink ${b.name}`}
                      disabled={link.isPending}
                      onClick={() => link.mutate({ bid: b, accountId: null })}
                    >
                      <Unlink className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!readOnly && linking && (
            <div className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Input
                  type="search"
                  autoFocus
                  placeholder="Search saved bids not linked to a customer…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="bg-background"
                />
                <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>
                  Done
                </Button>
              </div>
              {unlinked.error ? (
                <p className="text-sm text-destructive">Search failed: {errText(unlinked.error)}</p>
              ) : unlinked.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </p>
              ) : !unlinked.data?.length ? (
                <p className="text-sm text-muted-foreground">No unlinked bids match.</p>
              ) : (
                <div className="divide-y rounded-md border bg-card">
                  {unlinked.data.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                      <span className="text-xs capitalize text-muted-foreground">{b.status}</span>
                      <span className="text-sm tabular-nums">
                        {money(Number(b.grand_total) || 0)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={link.isPending}
                        onClick={() => link.mutate({ bid: b, accountId })}
                      >
                        Link
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Documents (owner, Oct 26: the CenterPoint-style document generator): every proposal, report
 * and letter ever made for this customer, across its bids and tickets — the list's For column
 * names the record each one belongs to. Documents are made from the bid or the ticket (each by a
 * click there), so this section only lists and opens them.
 */
function DocumentsSection({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Documents">
      <div className="flex items-center justify-between gap-2" data-fold={open ? "open" : "folded"}>
        <h2 className="min-w-0 flex-1 font-semibold">
          <button
            type="button"
            aria-expanded={open}
            title={open ? "Fold Documents" : "Show Documents"}
            className="-mx-1 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                open ? "" : "-rotate-90"
              }`}
              aria-hidden
            />
            <FileText className="h-4 w-4 shrink-0" aria-hidden /> Documents
            <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
              · proposals, reports and letters from this customer's bids and tickets
            </span>
          </button>
        </h2>
      </div>
      {open && <DocumentsList accountId={accountId} />}
    </section>
  );
}
