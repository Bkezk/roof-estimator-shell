/**
 * Pipe stacks on a bid (owner, Oct 6): the Pipe Stacks screen's Edit button lets the estimator
 * change a saved row's Open / Closed, size, quantity and colour. The row keeps everything else
 * — its id (the labor % and the result's per-stack hours hang off it), its labor adjustment, its
 * usage and its link back to a takeoff or PlanSwift row. A closed-only size (the catalog's rule)
 * forces Closed, exactly as the entry form does. Pure: no React, unit tested.
 *
 * Also the PlanSwift import's default: a pipe stack is OPEN unless its row says "closed"
 * ("pipe stacks should default to open on planswift imports unless otherwise specified").
 */
import type { PipeStackEntry, PipeStackSizeRef } from "@/lib/engine/accessories";

export interface PipeStackEdit {
  open?: boolean;
  size?: number;
  quantity?: number;
  color?: string;
}

/** The row after an edit: the four editable fields, the closed-only rule, nothing else moved. */
export function applyPipeStackEdit<T extends PipeStackEntry>(
  row: T,
  edit: PipeStackEdit,
  sizes: readonly Pick<PipeStackSizeRef, "size" | "closedOnly">[],
): T {
  const size = edit.size ?? row.size;
  const closedOnly = sizes.find((s) => s.size === size)?.closedOnly ?? false;
  const open = closedOnly ? false : (edit.open ?? row.open);
  return {
    ...row,
    size,
    open,
    quantity: edit.quantity ?? row.quantity,
    color: edit.color ?? row.color,
  };
}

/** An edit may be saved when its quantity is a whole number above zero and its size is known. */
export function pipeStackEditProblem(
  edit: Required<Pick<PipeStackEdit, "quantity" | "size">>,
  sizes: readonly Pick<PipeStackSizeRef, "size">[],
): string | null {
  if (!Number.isFinite(edit.quantity) || edit.quantity <= 0) return "Quantity must be above 0";
  if (!Number.isInteger(edit.quantity)) return "Quantity must be a whole number";
  if (!sizes.some((s) => s.size === edit.size)) return "Pick a size";
  return null;
}

/** PlanSwift: a pipe stack row is open unless its name says closed ("3\" Closed Stack"). */
export const pipeStackOpenFromName = (name: string): boolean => !/\bclosed\b/i.test(name);
