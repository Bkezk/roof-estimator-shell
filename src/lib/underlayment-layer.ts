/**
 * The underlayment layer the form writes (owner, Oct 26: "he entered the quotes for the tapered
 * it automatically shows a fastener on the visual and when he clicks attachment method none …
 * it cleared the tapered quotes"). "Apply layer N to selected" used to build the layer from the
 * form alone, so a quoted layer whose attachment was changed lost its quote. The quote stays
 * with the layer as long as the board is the same (a different board is a different layer, and
 * a quote belongs to its board); the attachment, adhesive and quoted adhesive containers are the
 * form's. A quote bills its material and labor verbatim and never adds fasteners
 * (engine/consumption.ts skips quoted layers), so the attachment on a quoted layer only decides
 * what the stack draws and, under adhesive, the containers it bills (§10.7).
 */
import type { UnderlaymentLayer } from "@/lib/engine/bid-builder";

export interface LayerForm {
  board: string;
  attachment: UnderlaymentLayer["attachment"];
  adhesiveName: string;
  /** "Quote containers (over tapered)": billed only under adhesive, and only above 0. */
  quoteAdhesiveUnits: number;
}

/** The layer to store for the form, over the layer the slot already holds (if any). */
export function nextLayerFromForm(
  existing: UnderlaymentLayer | undefined,
  form: LayerForm,
): UnderlaymentLayer {
  const adhesive = form.attachment === "adhesive";
  return {
    board: form.board,
    attachment: form.attachment,
    fastenersPerBoard: 0,
    adhesiveName: adhesive ? form.adhesiveName : "",
    // The engine derives the substrate (deck / layer below, legacy).
    substrate: "",
    ...(adhesive && form.quoteAdhesiveUnits > 0
      ? { quoteAdhesiveUnits: form.quoteAdhesiveUnits }
      : {}),
    ...(existing?.quote && existing.board === form.board ? { quote: existing.quote } : {}),
  };
}
