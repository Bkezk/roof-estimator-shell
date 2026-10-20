/**
 * The compact person select on a Work Overview Unassigned row (owner, Oct 15: "Assign to…"
 * beside Claim): a placeholder that never holds a value — a pick assigns at once and the row
 * leaves the group — with the roster loading the first time it opens (components/my-work-actions
 * .tsx useWorkActions owns the rosters and the server calls). With a `value` (Oct 20: the
 * assign-for-a-day dialog) it holds the pick until the dialog's Assign sends it.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AssignOption {
  id: string;
  name: string;
}

export function AssignSelect({
  label,
  roster,
  loading,
  error,
  disabled,
  onOpen,
  onPick,
  value = "",
}: {
  label: string;
  roster: AssignOption[];
  /** The held pick (the dialog); the row's select leaves it out and never holds one. */
  value?: string;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  /** The select opened: load its roster. */
  onOpen: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onOpenChange={(o) => {
        if (o) onOpen();
      }}
      onValueChange={(v) => {
        if (v) onPick(v);
      }}
    >
      <SelectTrigger className="h-8 w-40 text-xs" aria-label={label} data-select="assign">
        <SelectValue placeholder="Assign to…" />
      </SelectTrigger>
      <SelectContent>
        {error ? (
          <p className="px-2 py-1.5 text-xs text-destructive">Could not load the people: {error}</p>
        ) : loading ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Nobody to pick.</p>
        ) : (
          roster.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
