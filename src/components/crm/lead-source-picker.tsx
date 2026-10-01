/**
 * The opportunity's Lead source box (owner, Oct 1): a list kept under Settings › General › Lead
 * sources. Clicking opens the whole list; typing filters it (lib/lead-sources.ts
 * filterLeadSources); a name not on the list shows a last row "Add '…'" that adds it
 * (addLeadSource, Customers access) and picks it. The value is the name (text) the opportunity
 * stores; a name no longer on the list (an old row) still shows as it is. Same look as the
 * county code box.
 */
import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

import { filterLeadSources, leadSourceToAdd } from "@/lib/lead-sources";
import { addLeadSource, type LeadSource } from "@/lib/lead-sources.functions";
import { LEAD_SOURCES_KEY, useLeadSources } from "@/components/crm/use-lead-sources";
import { Input } from "@/components/ui/input";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Row = { kind: "pick"; row: LeadSource } | { kind: "add"; name: string };

export function LeadSourcePicker(props: {
  value: string;
  onChange: (name: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const sources = useLeadSources();
  const addFn = useServerFn(addLeadSource);
  // null = not typing: the box shows the picked name.
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all = sources.data ?? [];
  const toAdd = text !== null && !sources.isLoading ? leadSourceToAdd(all, text) : null;
  const rows: Row[] = [
    ...filterLeadSources(all, text ?? "").map((row) => ({ kind: "pick" as const, row })),
    ...(toAdd ? [{ kind: "add" as const, name: toAdd }] : []),
  ];

  const add = useMutation({
    mutationFn: (name: string) => addFn({ data: { name } }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: LEAD_SOURCES_KEY });
      props.onChange(row.name);
      toast.success(`Added the lead source “${row.name}”`);
    },
    onError: (e) => toast.error(`Could not add the lead source: ${errText(e)}`),
  });

  const choose = (r: Row) => {
    setText(null);
    setOpen(false);
    if (r.kind === "pick") props.onChange(r.row.name);
    else add.mutate(r.name);
  };
  const shown = text ?? props.value;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={props.id}
          value={shown}
          disabled={props.disabled || add.isPending}
          placeholder="Pick or type a lead source…"
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
              // Never submit the opportunity form from this box.
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
        {add.isPending ? (
          <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          props.value &&
          !props.disabled && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
              title="Clear the lead source"
              aria-label="Clear the lead source"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                props.onChange("");
                setText("");
                inputRef.current?.focus();
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )
        )}
      </div>
      {open && !props.disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {sources.error ? (
            <p className="px-2 py-1.5 text-sm text-destructive">
              Could not load the lead sources: {errText(sources.error)}
            </p>
          ) : sources.isLoading ? (
            <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              {all.length ? "Type a name to add it." : "No lead sources yet — type one to add it."}
            </p>
          ) : null}
          {rows.map((r, i) => (
            <div
              key={r.kind === "pick" ? r.row.id : "add"}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm ${
                i === active ? "bg-accent text-accent-foreground" : ""
              } ${r.kind === "pick" && r.row.name === props.value ? "font-medium" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
            >
              {r.kind === "pick" ? (
                r.row.name
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 shrink-0" /> {`Add '${r.name}'`}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
