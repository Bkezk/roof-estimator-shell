/**
 * The price-list picker (category list on the left, search across every item, Add per row) the
 * estimator uses for its catalog lines; shared with the accessory groups' Other accessories
 * screens (lib/accessory-families.ts).
 */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function CatalogPicker({
  items,
  onAdd,
}: {
  items: Array<{ key: string; category: string; description: string; price: number }>;
  onAdd: (key: string) => void;
}) {
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  const shown = searching
    ? items.filter((i) => `${i.category} ${i.description}`.toLowerCase().includes(query))
    : cat !== null
      ? items.filter((i) => i.category === cat)
      : [];
  return (
    <div className="mb-4 grid gap-3 rounded-md border p-3 md:grid-cols-[230px_minmax(0,1fr)]">
      <div className="space-y-2">
        <Input
          className="h-8"
          placeholder="Search all items…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCat(cat === c ? null : c);
                setQ("");
              }}
              className={`flex w-full items-center justify-between gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0 ${
                cat === c && !searching
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-muted"
              }`}
            >
              <span>{c}</span>
              <span className="text-muted-foreground tabular-nums">
                {items.filter((i) => i.category === c).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border">
        {shown.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {searching ? "No items match." : "Pick a category on the left, or search."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {shown.map((i) => (
                <tr key={i.key} className="border-b last:border-b-0 hover:bg-muted/50">
                  <td className="px-2.5 py-1.5">
                    {searching && (
                      <span className="block text-[11px] text-muted-foreground">{i.category}</span>
                    )}
                    {i.description}
                  </td>
                  <td className="w-24 px-2.5 py-1.5 text-right tabular-nums">{money(i.price)}</td>
                  <td className="w-16 px-2 py-1 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => onAdd(i.key)}
                    >
                      Add
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
