/**
 * The "Linked to <customer> · <site>" line under a bid's customer name
 * (docs/service-module-design.md §11, "Linking a bid"): Unlink, and — when the bid's client
 * fields no longer match the profile — a "differs from profile" note with a one-click push back.
 * Display only; the caller owns the link, the comparison and the save.
 */
import { Link } from "@tanstack/react-router";
import { Link2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LinkedAccountChip(props: {
  accountId: string;
  label: string;
  /** Client fields that differ from the profile; null while the profile is loading. */
  differences: string[] | null;
  /** The profile could not be read (deleted, no access…). */
  error?: string | null;
  /** Show "Update profile" (the user may edit customer profiles). */
  canUpdate: boolean;
  /** Link the name to the Customers page (the user may open it). */
  canOpen: boolean;
  updating: boolean;
  onUnlink: () => void;
  onUpdateProfile: () => void;
}) {
  const diffs = props.differences ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-muted-foreground">
        <Link2 className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">
          Linked to{" "}
          {props.canOpen ? (
            <Link
              to="/customers"
              search={{ id: props.accountId }}
              target="_blank"
              className="font-medium text-foreground underline-offset-2 hover:underline"
              title="Open the customer profile in a new tab"
            >
              {props.label || "customer"}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{props.label || "customer"}</span>
          )}
        </span>
        <button
          type="button"
          className="ml-1 shrink-0 font-medium text-foreground hover:underline"
          title="Unlink this bid from the customer profile (the bid's fields stay as they are)"
          onClick={props.onUnlink}
        >
          Unlink
        </button>
      </span>
      {props.error ? (
        <span className="text-destructive">Profile not readable: {props.error}</span>
      ) : props.differences === null ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : diffs.length > 0 ? (
        <>
          <span
            className="text-amber-700 dark:text-amber-400"
            title={`Differs: ${diffs.join(", ")}`}
          >
            differs from profile ({diffs.join(", ")})
          </span>
          {props.canUpdate && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              disabled={props.updating}
              title="Save this bid's client name, contact, phone, email and address to the customer profile"
              onClick={props.onUpdateProfile}
            >
              {props.updating ? "Updating…" : "Update profile"}
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
