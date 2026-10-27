/**
 * "Material (optional)" on a non-parapet linear's Objects card (owner, Oct 27: "on the linear
 * other allow a search bar that doesn't have to be filled out that allows someone to search and
 * assign material so that way it can be imported into a bid"). A search box that type-searches
 * the whole price list — every row the estimator's own pickers can add (accessories catalog,
 * each accessory group's Other Accessories, Exceptional Metals, Non-DL), with its screen as the
 * category — and assigns one; the pick shows as a chip with × to clear; blank is fine.
 *
 * The list is `catalogSearchItems` (src/lib/takeoff/material.ts) over the estimator's own data,
 * read by ./use-engine-admin.ts `useCatalogSearchItems` under the estimator's query keys. A failed
 * load is shown in red under the box (and toasted once); the box stays usable with whatever did
 * load.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import type { LinearMaterial } from "@/lib/takeoff/model";
import {
  categoryLabel,
  materialFromItem,
  searchCatalog,
  type CatalogSearchItem,
} from "@/lib/takeoff/material";
import { loudError } from "@/components/service/field-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useCatalogSearchItems } from "./use-engine-admin";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MATERIAL_NOTE =
  "Optional. Searches every price-list item; the bid gets a line with this item × the length in feet (edit the quantity there if it is priced per roll or each).";

export function MaterialPicker(props: {
  id: string;
  value: LinearMaterial | undefined;
  onChange: (m: LinearMaterial | undefined) => void;
}) {
  const { items, ready, errors, firstError } = useCatalogSearchItems();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const toasted = useRef(false);
  useEffect(() => {
    if (errors.length && !toasted.current) {
      toasted.current = true;
      loudError(`Could not load ${errors.join(", ")} for the material search`, firstError);
    }
  }, [errors, firstError]);
  const hits = useMemo(() => searchCatalog(items, q), [items, q]);
  const pick = (it: CatalogSearchItem) => {
    props.onChange(materialFromItem(it));
    setQ("");
    setOpen(false);
  };
  const m = props.value;
  return (
    <div className="col-span-2 space-y-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        Material (optional)
      </Label>
      {m ? (
        <div
          className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm dark:bg-muted/20"
          data-testid="material-chip"
        >
          <span className="min-w-0 flex-1 truncate">
            {m.description}
            <span className="ml-1 text-xs text-muted-foreground">
              · {money(m.price)} · {categoryLabel(m)}
            </span>
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            aria-label="Clear material"
            onClick={() => props.onChange(undefined)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id={props.id}
            className="h-8"
            placeholder={ready ? "Search the price list…" : "Loading the price list…"}
            value={q}
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQ("");
                setOpen(false);
              } else if (e.key === "Enter" && hits[0]) {
                e.preventDefault();
                pick(hits[0]);
              }
            }}
          />
          {open && q.trim() && (
            <ul
              role="listbox"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md dark:border-border"
            >
              {hits.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  {ready ? "No items match." : "Still loading the price list…"}
                </li>
              ) : (
                hits.map((it) => (
                  <li key={it.key} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted dark:hover:bg-muted/60"
                      // Mouse down, not click: the input's blur would close the list first.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(it);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{it.description}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {categoryLabel(it)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{money(it.price)}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">{MATERIAL_NOTE}</p>
      {errors.length > 0 && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          Could not load {errors.join(", ")} — the search is missing those items.
        </p>
      )}
    </div>
  );
}
