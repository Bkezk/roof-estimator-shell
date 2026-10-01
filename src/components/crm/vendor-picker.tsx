/**
 * The Vendor box (owner, Oct 1: "We need somewhere to add vendor info like name, address etc,
 * then we can select them as a recipient"): an invoice's Bill To (billable vendors only) and a
 * purchase order's supplier (every vendor not archived). Clicking opens the list; typing filters
 * it (lib/vendors.ts filterVendors: each word typed starts a word of the name). The value is the
 * vendor's id; a vendor no longer on the list (archived, or not billable any more) still shows
 * by the name passed in `fallbackName`. Same look as the lead source and county code boxes.
 * Vendors are added on the Customers page's Vendors tab (admins and managers).
 */
import { useId, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { filterVendors, vendorCityState } from "@/lib/vendors";
import type { VendorRow } from "@/lib/vendors.functions";
import { useVendors } from "@/components/crm/use-vendors";
import { Input } from "@/components/ui/input";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VendorPicker(props: {
  /** The picked vendor's id, or null. */
  value: string | null;
  onChange: (vendor: VendorRow | null) => void;
  /** Only billable vendors (an invoice's Bill To). */
  billableOnly?: boolean | undefined;
  /** What to show for a picked vendor that is not on the list (archived, not billable). */
  fallbackName?: string | null | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const vendors = useVendors();
  // null = not typing: the box shows the picked name.
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all = (vendors.data ?? []).filter((v) => !props.billableOnly || v.billable);
  const rows = filterVendors(all, text ?? "");
  const picked = props.value ? all.find((v) => v.id === props.value) : undefined;
  const pickedName = props.value ? (picked?.name ?? props.fallbackName ?? "") : "";

  const choose = (v: VendorRow) => {
    setText(null);
    setOpen(false);
    props.onChange(v);
  };
  const shown = text ?? pickedName;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={props.id}
          value={shown}
          disabled={props.disabled}
          placeholder={props.placeholder ?? "Pick or type a vendor…"}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className={`pr-8 ${props.className ?? ""}`}
          onFocus={(e) => {
            e.currentTarget.select();
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setText(null);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (rows.length ? (a <= 0 ? rows.length : a) - 1 : 0));
            } else if (e.key === "Enter") {
              // Never submit the surrounding form from this box.
              e.preventDefault();
              if (open && rows.length) choose(rows[Math.min(active, rows.length - 1)]!);
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
            title="Clear the vendor"
            aria-label="Clear the vendor"
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
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {vendors.error ? (
            <p className="px-2 py-1.5 text-sm text-destructive">
              Could not load the vendors: {errText(vendors.error)}
            </p>
          ) : vendors.isLoading ? (
            <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              {all.length
                ? `No vendor matches “${(text ?? "").trim()}”.`
                : props.billableOnly
                  ? "No billable vendors yet. Add one on Customers › Vendors."
                  : "No vendors yet. Add one on Customers › Vendors."}
            </p>
          ) : null}
          {rows.map((v, i) => (
            <div
              key={v.id}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm ${
                i === active ? "bg-accent text-accent-foreground" : ""
              } ${v.id === props.value ? "font-medium" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(v)}
            >
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              {vendorCityState(v) && (
                <span className="shrink-0 text-xs text-muted-foreground">{vendorCityState(v)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
