/**
 * The JBK county code box on a site (owner, Oct 1: "selectable from a dropdown, or as you begin
 * to type in the dropdown it starts sorting for you"). Clicking opens the whole list (state, then
 * county); typing filters it on the code, the county or the state (lib/county-codes.ts
 * filterCountyCodes). The ✕ clears it to none. Same look as the customer typeahead.
 *
 * The list is one cached read (use-county-codes.ts); CountyCodeLine shows a site's code as
 * "County code 0022 · Anderson, TN" (the site card, the ticket).
 */
import { useId, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { countyCodeLabel, filterCountyCodes } from "@/lib/county-codes";
import type { CountyCode } from "@/lib/county-codes.functions";
import { useCountyCode, useCountyCodes } from "@/components/crm/use-county-codes";
import { Input } from "@/components/ui/input";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "County code 0022 · Anderson, TN" — nothing when the site has no code. */
export function CountyCodeLine(props: { id: string | null | undefined; className?: string }) {
  const row = useCountyCode(props.id);
  if (!row) return null;
  return (
    <p className={props.className ?? "text-xs"}>
      <span className="font-medium">County code </span>
      {countyCodeLabel(row)}
    </p>
  );
}

export function CountyCodePicker(props: {
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const codes = useCountyCodes();
  // null = not typing: the box shows the picked code's label.
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all = codes.data ?? [];
  const picked = props.value ? all.find((c) => c.id === props.value) : undefined;
  const rows = filterCountyCodes(all, text ?? "");

  const pick = (row: CountyCode) => {
    props.onChange(row.id);
    setText(null);
    setOpen(false);
  };
  const shown =
    text ?? (picked ? countyCodeLabel(picked) : props.value && codes.isLoading ? "Loading…" : "");

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={props.id}
          value={shown}
          disabled={props.disabled}
          placeholder="Pick or type a code or county…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="pr-8"
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
              // Never submit the surrounding site form from this box.
              e.preventDefault();
              if (open && rows.length) pick(rows[Math.min(active, rows.length - 1)]!);
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
            title="Clear the county code"
            aria-label="Clear the county code"
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
          {codes.error ? (
            <p className="px-2 py-1.5 text-sm text-destructive">
              Could not load the county codes: {errText(codes.error)}
            </p>
          ) : codes.isLoading ? (
            <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              {all.length ? "No code matches." : "No county codes yet."}
            </p>
          ) : null}
          {rows.map((r, i) => (
            <div
              key={r.id}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer rounded-sm px-2 py-1.5 text-sm ${
                i === active ? "bg-accent text-accent-foreground" : ""
              } ${r.id === props.value ? "font-medium" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              {countyCodeLabel(r)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
