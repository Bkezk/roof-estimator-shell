import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PriceTarget } from "@/lib/admin-item-numbers.functions";
import { groupByBranch } from "@/lib/catalog-branches";
import type { TargetRef } from "@/lib/item-number-targets";

/**
 * Pick a screen → product row → price column (the cell an item number points at). The screens
 * are listed under their branch — Duro-Last Pricing, Non Duro-Last Pricing, Non-DL TPO
 * Accessories, EPDM Accessories (catalog-branches.ts) — since the accessory families (owner, Oct
 * 26–27) gave the same category name ("Sealants") to a screen on each.
 */
export function TargetPicker(props: {
  targets: PriceTarget[];
  value: TargetRef;
  onChange: (v: TargetRef) => void;
}) {
  const screen = props.targets.find((t) => t.screen_id === props.value.screen_id);
  const byBranch = groupByBranch(props.targets);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-[11px]">Screen</Label>
        <Select
          value={props.value.screen_id}
          onValueChange={(v) => {
            const t = props.targets.find((x) => x.screen_id === v);
            props.onChange({
              screen_id: v,
              row_label: t?.rows[0] ?? "",
              price_col: t?.price_cols[0] ?? "",
            });
          }}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Screen" />
          </SelectTrigger>
          <SelectContent>
            {byBranch.map((b) => (
              <SelectGroup key={b.branch}>
                <SelectLabel>{b.label}</SelectLabel>
                {b.items.map((t) => (
                  <SelectItem key={t.screen_id} value={t.screen_id}>
                    {t.category}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Product</Label>
        <Select
          value={props.value.row_label}
          onValueChange={(v) => props.onChange({ ...props.value, row_label: v })}
          disabled={!screen}
        >
          <SelectTrigger className="h-8 w-[260px] text-xs">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            {(screen?.rows ?? []).map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(screen?.price_cols.length ?? 0) > 1 && (
        <div className="space-y-1">
          <Label className="text-[11px]">Colour / size</Label>
          <Select
            value={props.value.price_col}
            onValueChange={(v) => props.onChange({ ...props.value, price_col: v })}
            disabled={!screen}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              {(screen?.price_cols ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
