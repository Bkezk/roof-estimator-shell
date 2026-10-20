/**
 * The way out of a sign-in that never settles (Oct 20): the gate's Waiting shows it after
 * SIGN_IN_STALL_MS, and so does the login page while it waits for the profile (`leaving`) — the
 * gate renders /login bare, before its own Waiting, so the page needs the notice itself.
 */
import { Button } from "@/components/ui/button";

/** Clear the browser's stored Supabase session and reload — the way out of a stuck sign-in. */
function startOver() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith("sb-")) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  window.location.href = "/login";
}

/** The explanation and Reload / Sign in again (the caller lays them out). */
export function StalledNotice() {
  return (
    <>
      <p className="max-w-sm text-sm text-muted-foreground">
        This is taking longer than it should. Your saved sign-in may be stuck, or the connection is
        slow.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button size="sm" onClick={startOver}>
          Sign in again
        </Button>
      </div>
    </>
  );
}
