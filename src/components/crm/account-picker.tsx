/**
 * The customer typeahead (docs/service-module-design.md §5.1, §11): one search box over accounts
 * and their sites. Picking a site row sets account + site in one click; the last row adds the
 * typed name as a new customer through a small inline dialog (quickCreateAccount) and selects it.
 * Used by the service ticket form and the Customers page's "New customer".
 */
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, MapPin, Plus, User, X } from "lucide-react";

import { quickCreateAccount, searchAccounts, type AccountHit } from "@/lib/crm.functions";
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
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // null = not typing: the input shows the picked value's label.
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const typed = text ?? "";
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
  const addLabel = typed.trim();
  // Rows: the hits, then (when something is typed) the "add as new customer" row.
  const rowCount = hits.length + (addLabel ? 1 : 0);

  useEffect(() => setActive(0), [debounced]);

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

  const shown = text ?? props.value?.label ?? "";

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={props.id}
          value={shown}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          placeholder={props.placeholder ?? "Search customers and sites…"}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="pr-8"
          onFocus={(e) => {
            e.currentTarget.select();
            setOpen(true);
          }}
          onBlur={() => {
            // Give a row's mousedown a chance first (it prevents default, so blur follows).
            setOpen(false);
            setText(null);
          }}
          onChange={(e) => {
            setText(e.target.value);
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
              setActive((a) => (rowCount ? (a - 1 + rowCount) % rowCount : 0));
            } else if (e.key === "Enter") {
              // Never submit a surrounding form from the search box.
              e.preventDefault();
              if (open && rowCount) choose(Math.min(active, rowCount - 1));
            } else if (e.key === "Escape") {
              if (open || text !== null) {
                e.preventDefault();
                e.stopPropagation();
              }
              setOpen(false);
              setText(null);
            }
          }}
        />
        {props.value && !props.disabled && (
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
          ) : hits.length === 0 && !addLabel ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No customers yet. Type a name to add one.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No match.</p>
          ) : null}
          {hits.map((h, i) => (
            <div
              key={`${h.account_id}:${h.site_id ?? ""}`}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm ${
                i === active ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              {h.site_id ? (
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : h.kind === "individual" ? (
                <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {h.site_id ? (
                <span className="min-w-0">
                  <span className="font-medium">{h.site_name}</span>
                  <span className="text-muted-foreground">
                    {" — "}
                    {h.account_name}
                    {h.site_address ? `, ${h.site_address}` : ""}
                  </span>
                </span>
              ) : (
                <span className="min-w-0">
                  <span className="font-medium">{h.account_name}</span>
                  <span className="text-muted-foreground"> ({h.kind})</span>
                </span>
              )}
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
        }}
      />
    </div>
  );
}

/**
 * New customer in one step: the account and (when a site name or address is given) its first
 * site. An individual's site defaults to their own name.
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
  const [phone, setPhone] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteTouched, setSiteTouched] = useState(false);
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("KY");
  const [zip, setZip] = useState("");

  // Reset each time the dialog opens, prefilled with the typed name.
  useEffect(() => {
    if (!props.open) return;
    setName(props.initialName);
    setKind("company");
    setContact("");
    setPhone("");
    setSiteName("");
    setSiteTouched(false);
    setAddress1("");
    setCity("");
    setState("KY");
    setZip("");
  }, [props.open, props.initialName]);

  // An individual's site is their own name unless edited.
  const effectiveSite = siteTouched ? siteName : kind === "individual" ? name : siteName;

  const save = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          kind,
          contact_name: contact,
          phone,
          site_name: effectiveSite,
          address1,
          city,
          state,
          zip,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            The customer and their first site in one step. Everything but the name can be filled in
            later on the Customers page.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            // The dialog is portalled, but React still bubbles submit to a surrounding form.
            e.stopPropagation();
            if (!name.trim()) {
              toast.error("The customer needs a name");
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
              <Label htmlFor="qa-phone">Phone</Label>
              <Input
                id="qa-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="qa-site">Site name</Label>
            <Input
              id="qa-site"
              value={effectiveSite}
              placeholder="e.g. Yellow Creek Elementary (optional)"
              onChange={(e) => {
                setSiteTouched(true);
                setSiteName(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qa-address1">Address</Label>
            <Input
              id="qa-address1"
              value={address1}
              onChange={(e) => setAddress1(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-3">
            <div className="space-y-1">
              <Label htmlFor="qa-city">City</Label>
              <Input id="qa-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-state">State</Label>
              <Input id="qa-state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-zip">Zip</Label>
              <Input
                id="qa-zip"
                inputMode="numeric"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>
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
