/**
 * Customers — the CRM hub (docs/service-module-design.md §11). A customer is an account (a
 * company / group or an individual) with one or more sites; service tickets and bids link to
 * it. Left: the searchable list; right (`?id=<uuid>`): the account's fields, its sites, its
 * tickets and (with Estimate access) its bids. On a phone the two panes stack: the list, or
 * the open customer with a way back.
 *
 * The account and its sites open read-only; Edit switches a block to its form, Cancel puts it
 * back (owner, Sep 27). A new customer is offered the saved bids that look like it
 * (LinkBidsDialog), and the account keeps offering them in "Bids that look like this customer".
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Contact,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Unlink,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  deleteAccount,
  deleteContact,
  deleteSite,
  getAccount,
  linkBidToAccount,
  listAccounts,
  listContacts,
  listUnlinkedBids,
  saveAccount,
  saveContact,
  saveSite,
  siteAddressLine,
  suggestBidsForAccount,
  type AccountDetail,
  type AccountRow,
  type ContactWithSites,
  type LinkedBidRow,
  type SiteRow,
} from "@/lib/crm.functions";
import { SERVICE_STAGES, STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import { QuickAddCustomerDialog } from "@/components/crm/account-picker";
import { OfferBidLinks, type OfferAccount } from "@/components/crm/link-bids-dialog";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

export function CustomersPage({ id }: { id?: string | undefined }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  // A customer just added, offered the saved bids that look like it.
  const [offerFor, setOfferFor] = useState<OfferAccount | null>(null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Contact className="h-6 w-6" /> Customers
          </h1>
          <p className="text-sm text-muted-foreground">
            Companies and individuals, their sites, and the tickets and bids linked to them.
          </p>
        </div>
        <Button size="lg" className="text-base font-semibold" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-5 w-5" /> New customer
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(260px,340px)_1fr]">
        <div className={id ? "hidden md:block" : ""}>
          <AccountList activeId={id} />
        </div>
        <div className={id ? "" : "hidden md:block"}>
          {id ? (
            <AccountDetailPane key={id} id={id} />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Pick a customer on the left, or add a new one.
            </div>
          )}
        </div>
      </div>

      <QuickAddCustomerDialog
        open={adding}
        initialName=""
        onOpenChange={setAdding}
        onCreated={(hit) => {
          setAdding(false);
          void navigate({ to: "/customers", search: { id: hit.account_id } });
          setOfferFor({ id: hit.account_id, name: hit.account_name });
        }}
      />
      <OfferBidLinks account={offerFor} onDone={() => setOfferFor(null)} />
    </div>
  );
}

function AccountList({ activeId }: { activeId?: string | undefined }) {
  const { session } = useAuth();
  const listFn = useServerFn(listAccounts);
  const list = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (a) =>
      !q ||
      [a.name, a.city, a.contact_name, a.external_id, a.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Search name, city, contact, customer #…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
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
        <p className="text-sm text-muted-foreground">No customer matches “{search.trim()}”.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((a) => (
            <Link
              key={a.id}
              to="/customers"
              search={{ id: a.id }}
              className={`block px-3 py-2 transition-colors hover:bg-muted/60 ${
                a.id === activeId ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {a.kind === "individual" ? (
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
                  {a.kind === "individual" ? "Individual" : "Company"}
                </Badge>
              </div>
              <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
                {[
                  a.city,
                  `${a.site_count} site${a.site_count === 1 ? "" : "s"}`,
                  a.open_jobs ? `${a.open_jobs} open ticket${a.open_jobs === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Link>
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
  const { session, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getAccount);
  const deleteFn = useServerFn(deleteAccount);
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

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 md:hidden">
      <Link to="/customers">
        <ArrowLeft className="mr-1 h-4 w-4" /> All customers
      </Link>
    </Button>
  );

  if (detail.error)
    return (
      <div className="space-y-3">
        {back}
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
  return (
    <div className="space-y-6">
      {back}
      <AccountBlock account={d.account} onDelete={() => setConfirmDelete(true)} />
      <ContactsSection accountId={id} sites={d.sites} />
      <SitesSection accountId={id} sites={d.sites} />
      <TicketsSection jobs={d.jobs} />
      {can("estimate") && <BidsSection accountId={id} bids={d.bids} />}

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
              The customer disappears from the list and the searches. Its tickets and bids keep the
              customer name they were saved with.
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
  phone: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  billing_instructions: string;
  external_id: string;
  notes: string;
};
const accountFields = (a: AccountRow): AccountFields => ({
  name: a.name,
  kind: a.kind === "individual" ? "individual" : "company",
  contact_name: a.contact_name ?? "",
  phone: a.phone ?? "",
  email: a.email ?? "",
  address1: a.address1 ?? "",
  address2: a.address2 ?? "",
  city: a.city ?? "",
  state: a.state ?? "",
  zip: a.zip ?? "",
  billing_instructions: a.billing_instructions ?? "",
  external_id: a.external_id ?? "",
  notes: a.notes ?? "",
});

/** The account's fields: a read-only summary, or (after Edit) the form. */
function AccountBlock({ account, onDelete }: { account: AccountRow; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <AccountForm account={account} onDone={() => setEditing(false)} />;
  return <AccountSummary account={account} onEdit={() => setEditing(true)} onDelete={onDelete} />;
}

function AccountSummary(props: { account: AccountRow; onEdit: () => void; onDelete: () => void }) {
  const a = props.account;
  const street = [a.address1, a.address2].filter((x) => x && x.trim()).join(", ");
  const cityLine = [a.city, [a.state, a.zip].filter((x) => x && x.trim()).join(" ")]
    .filter((x) => x && x.trim())
    .join(", ");
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
          </h2>
          <p className="text-xs text-muted-foreground">
            Updated {shortDate(a.updated_at)}
            {a.updated_by_name ? ` by ${a.updated_by_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {row("Contact", a.contact_name)}
        {row(
          "Phone",
          a.phone ? (
            <a href={`tel:${a.phone}`} className="underline-offset-2 hover:underline">
              {a.phone}
            </a>
          ) : null,
        )}
        {row(
          "Email",
          a.email ? (
            <a href={`mailto:${a.email}`} className="break-all underline-offset-2 hover:underline">
              {a.email}
            </a>
          ) : null,
        )}
        {row(
          "Billing address",
          street || cityLine ? (
            <>
              {street && <span className="block">{street}</span>}
              {cityLine && <span className="block">{cityLine}</span>}
            </>
          ) : null,
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

  const save = useMutation({
    mutationFn: () => saveFn({ data: { id: account.id, ...f } }),
    onSuccess: (row) => {
      toast.success("Customer saved");
      qc.setQueryData<AccountDetail>(["account", row.id], (old) =>
        old ? { ...old, account: row } : old,
      );
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["account-search"] });
      // A new name may match other saved bids.
      void qc.invalidateQueries({ queryKey: ["bid-suggestions", row.id] });
      onDone();
    },
    onError: (e) => toast.error(`Could not save the customer: ${errText(e)}`),
  });

  const field = (k: keyof AccountFields, label: string, props?: { type?: string }) => (
    <div className="space-y-1">
      <Label htmlFor={`acct-${k}`}>{label}</Label>
      <Input
        id={`acct-${k}`}
        type={props?.type ?? "text"}
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
        if (!f.name.trim()) {
          toast.error("The customer needs a name");
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
      <div className="grid gap-3 sm:grid-cols-3">
        {field("contact_name", "Contact")}
        {field("phone", "Phone", { type: "tel" })}
        {field("email", "Email", { type: "email" })}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Billing address</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            aria-label="Billing address line 1"
            placeholder="Address line 1"
            value={f.address1}
            onChange={(e) => set("address1", e.target.value)}
          />
          <Input
            aria-label="Billing address line 2"
            placeholder="Address line 2"
            value={f.address2}
            onChange={(e) => set("address2", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-3">
          <Input
            aria-label="City"
            placeholder="City"
            value={f.city}
            onChange={(e) => set("city", e.target.value)}
          />
          <Input
            aria-label="State"
            placeholder="State"
            value={f.state}
            onChange={(e) => set("state", e.target.value)}
          />
          <Input
            aria-label="Zip"
            placeholder="Zip"
            inputMode="numeric"
            value={f.zip}
            onChange={(e) => set("zip", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="acct-billing">Billing instructions</Label>
        <Textarea
          id="acct-billing"
          rows={2}
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
          <Textarea
            id="acct-notes"
            rows={2}
            value={f.notes}
            onChange={(e) => set("notes", e.target.value)}
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

type SiteFields = {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  technician_instructions: string;
};
const siteFields = (s: SiteRow | null): SiteFields => ({
  name: s?.name ?? "",
  address1: s?.address1 ?? "",
  address2: s?.address2 ?? "",
  city: s?.city ?? "",
  state: s ? (s.state ?? "") : "KY",
  zip: s?.zip ?? "",
  technician_instructions: s?.technician_instructions ?? "",
});

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

function ContactsSection({ accountId, sites }: { accountId: string; sites: SiteRow[] }) {
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
    if (ids.length === 0) return "All sites";
    const names = ids.flatMap((sid) => siteName.get(sid) ?? []);
    return names.length ? names.join(", ") : "A deleted site";
  };
  const rows = contacts.data ?? [];

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Contacts">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4" /> Contacts
          {contacts.data && (
            <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
          )}
        </h2>
        {editing !== "new" && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" /> Add contact
          </Button>
        )}
      </div>
      {contacts.error ? (
        <p className="text-sm text-destructive">
          Could not load the contacts: {errText(contacts.error)}
        </p>
      ) : contacts.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
        </p>
      ) : (
        rows.length === 0 &&
        editing !== "new" && (
          <p className="text-sm text-muted-foreground">
            No contacts yet. Add the people you call: the site contact, who approves work, who gets
            the invoice.
          </p>
        )
      )}
      <div className="space-y-2">
        {rows.map((c) =>
          editing === c.id ? (
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
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2"
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
            </div>
          ),
        )}
        {editing === "new" && (
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
              They disappear from this customer and from the site contact choices on tickets.
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
        <legend className="text-sm font-medium">Sites</legend>
        {props.sites.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This customer has no sites yet; the contact covers the whole account.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Tick the sites they are the contact for; none ticked = all sites.
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

function SitesSection({ accountId, sites }: { accountId: string; sites: SiteRow[] }) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteSite);
  // "new" = the add form is open; an id = that site is being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SiteRow | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["account", accountId] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
    void qc.invalidateQueries({ queryKey: ["account-search"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Site deleted");
      setToDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the site: ${errText(e)}`),
  });

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Sites">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <MapPin className="h-4 w-4" /> Sites
          <span className="text-xs font-normal text-muted-foreground">{sites.length}</span>
        </h2>
        {editing !== "new" && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" /> Add site
          </Button>
        )}
      </div>
      {sites.length === 0 && editing !== "new" && (
        <p className="text-sm text-muted-foreground">
          No sites yet. A site is a building or address the work happens at.
        </p>
      )}
      <div className="space-y-2">
        {sites.map((s) =>
          editing === s.id ? (
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
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-sm text-muted-foreground">
                  {siteAddressLine(s) || "No address on file"}
                </p>
                {s.technician_instructions && (
                  <p className="mt-1 whitespace-pre-line text-xs">
                    <span className="font-medium">Technician instructions: </span>
                    {s.technician_instructions}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  title="Edit this site"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => setEditing(s.id)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  title="Delete this site"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => setToDelete(s)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ),
        )}
        {editing === "new" && (
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
            <AlertDialogTitle>Delete the site “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Tickets at this site keep the site name and address they were saved with.
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

function SiteForm(props: {
  accountId: string;
  site: SiteRow | null;
  onDone: (changed: boolean) => void;
}) {
  const saveFn = useServerFn(saveSite);
  const [f, setF] = useState<SiteFields>(() => siteFields(props.site));
  const set = <K extends keyof SiteFields>(k: K, v: SiteFields[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(props.site ? { id: props.site.id } : {}),
          account_id: props.accountId,
          ...f,
        },
      }),
    onSuccess: () => {
      toast.success(props.site ? "Site saved" : "Site added");
      props.onDone(true);
    },
    onError: (e) => toast.error(`Could not save the site: ${errText(e)}`),
  });
  const idp = props.site?.id ?? "new";
  return (
    <form
      className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) {
          toast.error("The site needs a name");
          return;
        }
        save.mutate();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`site-${idp}-name`}>Site name</Label>
        <Input
          id={`site-${idp}-name`}
          autoFocus
          value={f.name}
          placeholder="e.g. Yellow Creek Elementary"
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label="Address line 1"
          placeholder="Address line 1"
          value={f.address1}
          onChange={(e) => set("address1", e.target.value)}
        />
        <Input
          aria-label="Address line 2"
          placeholder="Address line 2"
          value={f.address2}
          onChange={(e) => set("address2", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
        <Input
          aria-label="City"
          placeholder="City"
          value={f.city}
          onChange={(e) => set("city", e.target.value)}
        />
        <Input
          aria-label="State"
          placeholder="State"
          value={f.state}
          onChange={(e) => set("state", e.target.value)}
        />
        <Input
          aria-label="Zip"
          placeholder="Zip"
          inputMode="numeric"
          value={f.zip}
          onChange={(e) => set("zip", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`site-${idp}-tech`}>Technician instructions</Label>
        <Textarea
          id={`site-${idp}-tech`}
          rows={2}
          placeholder="e.g. Check in at the front office; roof hatch in the boiler room"
          value={f.technician_instructions}
          onChange={(e) => set("technician_instructions", e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {props.site ? "Save site" : "Add site"}
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

function TicketsSection({ jobs }: { jobs: AccountDetail["jobs"] }) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Tickets">
      <h2 className="flex items-center gap-2 font-semibold">
        <Wrench className="h-4 w-4" /> Tickets
        <span className="text-xs font-normal text-muted-foreground">{jobs.length}</span>
      </h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service tickets for this customer.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {jobs.map((j) => (
            <Link
              key={j.id}
              to="/service"
              search={{ id: j.id }}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm hover:bg-muted/60"
            >
              <span className="font-medium">#{j.number}</span>
              <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                {stageLabel(j.stage)}
              </Badge>
              <span className="min-w-0 flex-1 truncate">
                {j.site_name ? `${j.site_name} · ` : ""}
                {j.description || "No description"}
              </span>
              <span className="text-xs text-muted-foreground">
                {j.scheduled_date ? day(j.scheduled_date) : `Updated ${shortDate(j.updated_at)}`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function BidsSection({ accountId, bids }: { accountId: string; bids: LinkedBidRow[] }) {
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
    enabled: !!session,
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

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Bids">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Link2 className="h-4 w-4" /> Bids
          <span className="text-xs font-normal text-muted-foreground">{bids.length}</span>
        </h2>
        {!linking && (
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Plus className="mr-1 h-4 w-4" /> Link a bid
          </Button>
        )}
      </div>
      {!!suggested.data?.length && (
        <div
          className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/40"
          aria-label="Bids that look like this customer"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Bids that look like this customer
          </p>
          <div className="divide-y rounded-md border bg-background">
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
                <span className="text-sm tabular-nums">{money(Number(b.grand_total) || 0)}</span>
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
        <div className="divide-y rounded-md border">
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
            </div>
          ))}
        </div>
      )}
      {linking && (
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
            <div className="divide-y rounded-md border bg-background">
              {unlinked.data.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                  <span className="text-xs capitalize text-muted-foreground">{b.status}</span>
                  <span className="text-sm tabular-nums">{money(Number(b.grand_total) || 0)}</span>
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
    </section>
  );
}
