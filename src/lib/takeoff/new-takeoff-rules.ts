/**
 * When the New takeoff dialog may create (owner, Oct 27: "customer shouldn't be required on
 * takeoff please remove that, just make it the name and plan file or aerial screenshot or
 * address"). The customer is optional for everyone; what is needed is:
 *   - Plan-set PDF / aerial screenshot: a name and the file;
 *   - From an address: the address picture (the name is optional — it defaults to the address).
 * Pure.
 */
export type NewTakeoffMode = "pdf" | "image" | "address";

export interface NewTakeoffForm {
  mode: NewTakeoffMode;
  /** The typed name (blank or whitespace counts as none). */
  name: string;
  /** Whether a plan file / screenshot has been chosen. */
  file: boolean | object | null | undefined;
  /** Whether the address option has a picture to use. */
  aerial: boolean | object | null | undefined;
}

export function canCreateTakeoff(form: NewTakeoffForm): boolean {
  if (form.mode === "address") return !!form.aerial;
  return !!form.file && form.name.trim().length > 0;
}

/** Why the dialog cannot create yet, for the toast (null when it can). */
export function newTakeoffBlocker(form: NewTakeoffForm): string | null {
  if (form.mode === "address")
    return form.aerial ? null : "Find the address (or pick the building on the map) first.";
  if (!form.name.trim()) return "Give the takeoff a name — the job or building, not the file.";
  if (!form.file)
    return form.mode === "pdf" ? "Choose the plan-set PDF first." : "Choose the screenshot first.";
  return null;
}
