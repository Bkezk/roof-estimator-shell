/**
 * The customer typeahead (docs/service-module-design.md §5.1, §11): one search box over the
 * customers (owner, Oct 1: customers only, no site rows; the form's site box picks the site
 * afterwards). A customer with exactly one site arrives with that site on the hit, so the form
 * selects it without another click. The last row adds the
 * typed name as a new customer through a small inline dialog (quickCreateAccount: the account
 * only, no site — sites are added on the Customers page afterwards) and selects it,
 * then offers to link saved bids that look like the new customer (LinkBidsDialog) — after the
 * pick, so the surrounding form (a ticket) keeps its state.
 * Used by tickets, bids, takeoffs, opportunities, the PlanSwift import and tasks.
 *
 * `allowFreeText` (the estimator's Setup › Customer Name and Job Name): the input is a plain text
 * field whose value the parent owns (`text` / `onText`); the dropdown only offers profiles to
 * link, nothing is highlighted until the arrow keys move, so typing a name and moving on never
 * links anything, and there is no quick-add row.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, Plus, User, X } from "lucide-react";

import { quickCreateAccount, searchAccounts, type AccountHit } from "@/lib/crm.functions";
import { CONTACT_REQUIRED, hasContactMethod } from "@/lib/crm-account";
import {
  AccountManagerSelect,
  AddressInputs,
  MailingAddressInputs,
  type AddressValue,
} from "@/components/crm/account-fields";
import { OfferBidLinks, type OfferAccount } from "@/components/crm/link-bids-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface AccountPickerValue {
  account_id: string;
  site_id: string | null;
  label: string;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AccountPicker(props: {
  value: AccountPickerValue | null;
  onChange: (hit: AccountHit | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  /** Free-text mode: the typed text is the field's value (see the header comment). */
  allowFreeText?: boolean;
  /** Free-text mode: the field's value. */
  text?: string;
  /** Free-text mode: called on every keystroke with the typed text. */
  onText?: (text: string) => void;
  /** The input lost focus (not when a row is clicked: the row keeps the focus). */
  onBlur?: () => void;
}) {
  const free = !!props.allowFreeText;
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // null = not typing: the input shows the picked value's label.
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  // A customer just added here, offered the saved bids that look like it.
  const [offerFor, setOfferFor] = useState<OfferAccount | null>(null);

  const typed = free ? (props.text ?? "") : (text ?? "");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(typed.trim()), 200);
    return () => clearTimeout(t);
  }, [typed]);

  const searchFn = useServerFn(searchAccounts);
  const search = useQuery({
    queryKey: ["account-search", debounced],
    queryFn: () => searchFn({ data: { q: debounced } }),
    enabled: open,
    staleTime: 30_000,
  });
  const hits = search.data ?? [];
  const addLabel = free ? "" : typed.trim();
  // Rows: the hits, then (when something is typed) the "add as new customer" row.
  const rowCount = hits.length + (addLabel ? 1 : 0);

  // Free text: no row is highlighted until the arrow keys pick one, so Enter never links by itself.
  useEffect(() => setActive(free ? -1 : 0), [debounced, free]);

  const pick = (hit: AccountHit) => {
    props.onChange(hit);
    setText(null);
    setOpen(false);
  };
  const choose = (i: number) => {
    if (i < hits.length) pick(hits[i]!);
    else if (addLabel) {
      setOpen(false);
      setAdding(addLabel);
    }
  };

  const shown = free ? typed : (text ?? props.value?.label ?? "");

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={props.id}
          value={shown}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          placeholder={props.placeholder ?? (free ? undefined : "Search customers…")}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className={free ? undefined : "pr-8"}
          onFocus={(e) => {
            // Free text opens the list on typing, not on every click into the field.
            if (free) return;
            e.currentTarget.select();
            setOpen(true);
          }}
          onBlur={() => {
            // Give a row's mousedown a chance first (it prevents default, so blur follows).
            setOpen(false);
            if (!free) setText(null);
            props.onBlur?.();
          }}
          onChange={(e) => {
            if (free) props.onText?.(e.target.value);
            else setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (rowCount ? (a + 1) % rowCount : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (rowCount ? (a <= 0 ? rowCount : a) - 1 : 0));
            } else if (e.key === "Enter") {
              // Never submit a surrounding form from the search box.
              e.preventDefault();
              if (open && rowCount && active >= 0) choose(Math.min(active, rowCount - 1));
              else if (free) setOpen(false);
            } else if (e.key === "Escape") {
              if (open || (!free && text !== null)) {
                e.preventDefault();
                e.stopPropagation();
              }
              setOpen(false);
              setText(null);
            }
          }}
        />
        {props.value && !props.disabled && !free && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
            title="Clear the customer"
            aria-label="Clear the customer"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              props.onChange(null);
              setText("");
              inputRef.current?.focus();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && !props.disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {search.error ? (
            <p className="px-2 py-1.5 text-sm text-destructive">
              Search failed: {errText(search.error)}
            </p>
          ) : search.isLoading ? (
            <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </p>
          ) : free && hits.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No saved customer matches. The name stays as typed.
            </p>
          ) : free ? (
            <p className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">
              Pick one to link this bid to the customer&apos;s profile.
            </p>
          ) : hits.length === 0 && !addLabel ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No customers yet. Type a name to add one.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No match.</p>
          ) : null}
          {hits.map((h, i) => (
            <div
              key={h.account_id}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm ${
                i === active ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              {h.kind === "individual" ? (
                <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0">
                <span className="font-medium">{h.account_name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  ({h.kind}){h.site_count > 1 ? ` · ${h.site_count} sites` : ""}
                </span>
              </span>
            </div>
          ))}
          {addLabel && (
            <div
              role="option"
              aria-selected={active === hits.length}
              className={`flex cursor-pointer items-center gap-2 rounded-sm border-t px-2 py-1.5 text-sm ${
                active === hits.length ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseEnter={() => setActive(hits.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(hits.length)}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>
                Add “<span className="font-medium">{addLabel}</span>” as a new customer
              </span>
            </div>
          )}
        </div>
      )}
      <QuickAddCustomerDialog
        open={adding !== null}
        initialName={adding ?? ""}
        onOpenChange={(o) => {
          if (!o) setAdding(null);
        }}
        onCreated={(hit) => {
          setAdding(null);
          pick(hit);
          setOfferFor({ id: hit.account_id, name: hit.account_name });
        }}
      />
      <OfferBidLinks account={offerFor} onDone={() => setOfferFor(null)} />
    </div>
  );
}

/**
 * New customer in one step: the account only (owner, Sep 30: its sites are added on the account
 * afterwards, under Customers). Needs an email, a cell phone or an office phone.
 */
export function QuickAddCustomerDialog(props: {
  open: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (hit: AccountHit) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(quickCreateAccount);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"company" | "individual">("company");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [phone, setPhone] = useState("");
  const [physical, setPhysical] = useState<AddressValue>(blankAddress("KY"));
  const [mailingSame, setMailingSame] = useState(true);
  const [mailing, setMailing] = useState<AddressValue>(blankAddress(""));
  const [manager, setManager] = useState("");
  // The "Add an email or a phone number" line shows once Save has been tried.
  const [tried, setTried] = useState(false);

  // Reset each time the dialog opens, prefilled with the typed name.
  useEffect(() => {
    if (!props.open) return;
    setName(props.initialName);
    setKind("company");
    setContact("");
    setEmail("");
    setMobile("");
    setPhone("");
    setPhysical(blankAddress("KY"));
    setMailingSame(true);
    setMailing(blankAddress(""));
    setManager("");
    setTried(false);
  }, [props.open, props.initialName]);

  const reachable = hasContactMethod({ email, phone, mobile });

  const save = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          kind,
          contact_name: contact,
          email,
          mobile,
          phone,
          ...physical,
          mailing_same: mailingSame,
          ...(mailingSame
            ? {}
            : {
                mailing_address1: mailing.address1,
                mailing_address2: mailing.address2,
                mailing_city: mailing.city,
                mailing_state: mailing.state,
                mailing_zip: mailing.zip,
              }),
          account_manager_id: manager || null,
        },
      }),
    onSuccess: (hit) => {
      toast.success(`Added ${hit.account_name}`);
      void qc.invalidateQueries({ queryKey: ["account-search"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      props.onCreated(hit);
    },
    onError: (e) => toast.error(`Could not add the customer: ${errText(e)}`),
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (save.isPending) return;
        props.onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            The name and one way to reach them (email or a phone) are required. Sites are added on
            the customer after it is saved.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            // The dialog is portalled, but React still bubbles submit to a surrounding form.
            e.stopPropagation();
            setTried(true);
            if (!name.trim()) {
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
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="qa-name">Name</Label>
              <Input
                id="qa-name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bell County BOE"
              />
            </div>
            <div className="space-y-1">
              <Label>Kind</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={kind}
                onValueChange={(v) => {
                  if (v === "company" || v === "individual") setKind(v);
                }}
              >
                <ToggleGroupItem value="company">Company</ToggleGroupItem>
                <ToggleGroupItem value="individual">Individual</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="qa-contact">Contact name</Label>
              <Input id="qa-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-email">Email</Label>
              <Input
                id="qa-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-mobile">Cell phone</Label>
              <Input
                id="qa-mobile"
                type="tel"
                inputMode="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-phone">Office phone</Label>
              <Input
                id="qa-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          {tried && !reachable && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {CONTACT_REQUIRED}
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">Physical address</p>
            <AddressInputs
              label="Physical address"
              value={physical}
              onChange={(k, v) => setPhysical((a) => ({ ...a, [k]: v }))}
            />
          </div>
          <MailingAddressInputs
            idPrefix="qa"
            same={mailingSame}
            onSame={setMailingSame}
            value={mailing}
            onChange={(k, v) => setMailing((a) => ({ ...a, [k]: v }))}
          />
          <AccountManagerSelect id="qa-manager" value={manager} onChange={setManager} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const blankAddress = (state: string): AddressValue => ({
  address1: "",
  address2: "",
  city: "",
  state,
  zip: "",
});
