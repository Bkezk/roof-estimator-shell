/**
 * Forgot password (owner, Nov 14: "add a reset password on the login screen, some office users
 * have forgotten their password? Ensure it's secure and works properly").
 *
 * The sign-in service does the sensitive part: it makes the link, emails it, lets it work once
 * and for a limited time, and refuses to send the browser anywhere but this site (checked live:
 * a used link and a link pointed at another site both come back with an error). The link opens
 * this site with what it needs after the "#" of the address, where no server ever sees it.
 *
 * This file is the site's side, kept pure so it can be tested:
 *   - reading that "#" part on arrival (a reset, or the service's "expired" answer), whatever
 *     page it landed on, and keeping the fact for this browser tab only;
 *   - what the person is told after asking for a link: always the same words, whether or not
 *     the email has an account, so nobody can use this page to find out who has one;
 *   - the rules a new password must meet, and plain words for the service's refusals.
 */

/** This tab is in the middle of a reset, or its link was refused (sessionStorage: this tab only). */
export const RECOVERY_KEY = "jbk-password-recovery";
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
/** How long the "Send link" button rests after a send, so it cannot be hammered. */
export const RESET_RESEND_WAIT_S = 60;

export type RecoveryArrival =
  { kind: "recovery" } | { kind: "error"; code: string; description: string } | null;

/**
 * What the address says on arrival. A reset link: `#access_token=…&type=recovery`. A refused one
 * (used already, too old): `#error=access_denied&error_code=otp_expired&error_description=…`,
 * which the service may also send as `?error=…`. Anything else: null.
 */
export function readRecoveryArrival(hash: string, search = ""): RecoveryArrival {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  if (h.get("type") === "recovery" && h.get("access_token")) return { kind: "recovery" };
  const from = h.get("error") || h.get("error_code") ? h : q;
  const code = from.get("error_code") || from.get("error");
  if (code)
    return {
      kind: "error",
      code,
      description: (from.get("error_description") || "").replace(/\+/g, " "),
    };
  return null;
}

/** What this tab remembers: a reset under way, a refused link, or nothing. */
export type RecoveryState = "pending" | "refused" | null;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export function recoveryState(store: Store | null | undefined): RecoveryState {
  try {
    const v = store?.getItem(RECOVERY_KEY);
    return v === "pending" || v === "refused" ? v : null;
  } catch {
    return null;
  }
}
export function setRecoveryState(store: Store | null | undefined, state: RecoveryState): void {
  try {
    if (state) store?.setItem(RECOVERY_KEY, state);
    else store?.removeItem(RECOVERY_KEY);
  } catch {
    // Storage switched off: the reset page still works from the address it was opened with.
  }
  tell();
}
/** For the gate: hear when the tab's reset state changes. */
export function onRecoveryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Called once as the page loads, before the sign-in client reads (and wipes) the address: note a
 * reset link or a refused one for this tab. An ordinary page load changes nothing.
 */
export function noteRecoveryArrival(
  loc: { hash: string; search: string } | null | undefined,
  store: Store | null | undefined,
): RecoveryArrival {
  if (!loc) return null;
  const arrival = readRecoveryArrival(loc.hash, loc.search);
  if (arrival?.kind === "recovery") setRecoveryState(store, "pending");
  else if (arrival?.kind === "error") setRecoveryState(store, "refused");
  return arrival;
}

// ── Asking for a link ─────────────────────────────────────

/** Shown after every request the service took, whether or not that email has an account. */
export const RESET_SENT_TEXT =
  "If that email has an account, a link to set a new password is on its way. It works one time. Check your junk folder if you do not see it in a few minutes.";
export const RESET_UNREACHABLE_TEXT =
  "Could not reach the sign-in service. Check your connection and try again.";
export const RESET_BAD_EMAIL_TEXT = "Enter the email address you sign in with.";

/**
 * What to say after asking for a link. Checked against the live service (Nov 14):
 *   - an email with no account: a plain yes, and nothing is sent;
 *   - an email with an account: a yes, or a refusal that only an account can get ("too many
 *     requests", "email to this address could not be delivered recently").
 * So every refusal of that kind is answered "sent", in the same words as a yes: saying anything
 * else would tell a stranger that the email has an account. The words themselves point to an
 * administrator for anyone whose email never comes. "invalid" only for something that is not an
 * email address at all (the service's validation_failed), which gives nothing away. No answer,
 * or a fault at the service (5xx): the request did not go through, and that is said.
 */
export function resetRequestOutcome(
  error:
    | { status?: number | undefined; code?: string | undefined; message?: string | undefined }
    | null
    | undefined,
): "sent" | "invalid" | "unreachable" {
  if (!error) return "sent";
  const msg = (error.message ?? "").toLowerCase();
  if (error.code === "validation_failed" || msg.includes("invalid format")) return "invalid";
  const s = error.status;
  if (typeof s === "number" && s >= 400 && s < 500) return "sent";
  return "unreachable";
}

// ── Setting the new password ─────────────────────────────────

/** The first thing wrong with a new password, in plain words; null when it may be sent. */
export function passwordProblem(
  password: string,
  confirm: string,
  email: string | null | undefined,
): string | null {
  if (password.length < PASSWORD_MIN)
    return `Use at least ${PASSWORD_MIN} characters for the new password.`;
  if (password.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  if (!password.trim()) return "The new password cannot be all spaces.";
  const e = (email ?? "").trim().toLowerCase();
  if (e && (password.toLowerCase() === e || password.toLowerCase() === e.split("@")[0]))
    return "Choose a password that is not your email address.";
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

export const RESET_LINK_DEAD_TEXT =
  "This reset link has expired or was already used. Ask for a new one from the sign-in screen.";

/** Plain words for the service's refusal of a new password. */
export function passwordUpdateError(
  error:
    | { status?: number | undefined; code?: string | undefined; message?: string | undefined }
    | null
    | undefined,
): string {
  const code = error?.code ?? "";
  const msg = (error?.message ?? "").toLowerCase();
  if (code === "same_password" || msg.includes("different from the old"))
    return "That is your current password. Choose a different one, or go back and sign in with it.";
  if (code === "weak_password" || msg.includes("weak") || msg.includes("pwned"))
    return "That password is too easy to guess or has appeared in a known leak. Choose a longer, less common one.";
  if (
    error?.status === 401 ||
    error?.status === 403 ||
    code === "session_not_found" ||
    msg.includes("session missing") ||
    msg.includes("jwt")
  )
    return RESET_LINK_DEAD_TEXT;
  if (!error?.status || error.status >= 500) return RESET_UNREACHABLE_TEXT;
  return "The new password was not saved. Please try again.";
}

/** Told once on the sign-in screen after a reset (kept in memory: gone on a reload). */
export const RESET_DONE_TEXT = "Your password was changed. Sign in with the new one.";
let resetJustDone = false;
export const markResetDone = () => {
  resetJustDone = true;
};
export function takeResetDone(): boolean {
  const was = resetJustDone;
  resetJustDone = false;
  return was;
}
