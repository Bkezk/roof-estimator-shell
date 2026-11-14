/**
 * Owner, Nov 14: "Can you add a reset password on the login screen, some office users have
 * forgotten their password? Ensure it's secure and works properly."
 *
 * Proven live on the test login: the sign-in service took the request and its link came back to
 * this site's reset page; the link worked once (a second use, and a link pointed at another
 * site, were refused); the new password signed in and the old one did not; another device that
 * was signed in could not renew its sign-in; the test login's password was put back.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { pageForPath } from "./access";
import {
  markResetDone,
  noteRecoveryArrival,
  onRecoveryChange,
  PASSWORD_MIN,
  passwordProblem,
  passwordUpdateError,
  readRecoveryArrival,
  RECOVERY_KEY,
  recoveryState,
  RESET_LINK_DEAD_TEXT,
  RESET_SENT_TEXT,
  RESET_UNREACHABLE_TEXT,
  resetRequestOutcome,
  setRecoveryState,
  takeResetDone,
} from "./recovery-link";

const read = (p: string) => readFileSync(p, "utf8");
function tabStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("what the address says when the page opens", () => {
  it("a reset link", () => {
    expect(
      readRecoveryArrival("#access_token=aaa&expires_in=3600&refresh_token=bbb&type=recovery"),
    ).toEqual({ kind: "recovery" });
  });
  it("a used or expired link, as the service really sends it", () => {
    expect(
      readRecoveryArrival(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({
      kind: "error",
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
    expect(readRecoveryArrival("", "?error=access_denied&error_code=otp_expired")?.kind).toBe(
      "error",
    );
  });
  it("an ordinary page, or another kind of sign-in, is nothing", () => {
    expect(readRecoveryArrival("", "")).toBeNull();
    expect(readRecoveryArrival("#section-2", "?bid=123")).toBeNull();
    expect(readRecoveryArrival("#access_token=aaa&type=magiclink")).toBeNull();
    // "type=recovery" alone, with no sign-in in it, starts nothing.
    expect(readRecoveryArrival("#type=recovery")).toBeNull();
  });
});

describe("what the tab remembers", () => {
  it("a reset link marks the tab; an ordinary load leaves it alone", () => {
    const s = tabStore();
    expect(noteRecoveryArrival({ hash: "", search: "" }, s)).toBeNull();
    expect(recoveryState(s)).toBeNull();
    noteRecoveryArrival({ hash: "#access_token=a&type=recovery", search: "" }, s);
    expect(recoveryState(s)).toBe("pending");
    // A later ordinary load in the same tab does not clear a reset under way.
    noteRecoveryArrival({ hash: "", search: "" }, s);
    expect(recoveryState(s)).toBe("pending");
  });
  it("a refused link is remembered as refused", () => {
    const s = tabStore();
    noteRecoveryArrival({ hash: "#error=access_denied&error_code=otp_expired", search: "" }, s);
    expect(recoveryState(s)).toBe("refused");
  });
  it("only the two known states count; anything else stored there is nothing", () => {
    const s = tabStore();
    s.setItem(RECOVERY_KEY, "yes please");
    expect(recoveryState(s)).toBeNull();
    expect(recoveryState(null)).toBeNull();
  });
  it("the gate hears every change, and storage that throws breaks nothing", () => {
    const heard = vi.fn();
    const off = onRecoveryChange(heard);
    const s = tabStore();
    setRecoveryState(s, "pending");
    setRecoveryState(s, null);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(recoveryState(s)).toBeNull();
    off();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => setRecoveryState(broken, "pending")).not.toThrow();
    expect(recoveryState(broken)).toBeNull();
  });
});

describe("asking for a link gives nothing away", () => {
  it("a yes, whatever the email", () => {
    expect(resetRequestOutcome(null)).toBe("sent");
  });
  it("refusals only an account can get are answered in the same words as a yes", () => {
    expect(resetRequestOutcome({ status: 429, code: "over_email_send_rate_limit" })).toBe("sent");
    // The live service's answer for an account whose last email bounced (Nov 14).
    expect(
      resetRequestOutcome({
        status: 400,
        code: "unknown",
        message:
          "Email to this address could not be delivered recently, so this message was not sent. Check the address or use a different one.",
      }),
    ).toBe("sent");
  });
  it("something that is not an email address is said to be one", () => {
    expect(
      resetRequestOutcome({
        status: 400,
        code: "validation_failed",
        message: "Unable to validate email address: invalid format",
      }),
    ).toBe("invalid");
  });
  it("no answer, or a fault at the service, is not called sent", () => {
    expect(resetRequestOutcome({})).toBe("unreachable");
    expect(resetRequestOutcome({ status: 0 })).toBe("unreachable");
    expect(resetRequestOutcome({ status: 500 })).toBe("unreachable");
    expect(resetRequestOutcome({ status: 503 })).toBe("unreachable");
  });
  it("the words never say whether the account exists, and name the other way in", () => {
    expect(RESET_SENT_TEXT).toMatch(/^If that email has an account,/);
    expect(RESET_SENT_TEXT).toContain("It works one time.");
  });
});

describe("the new password", () => {
  it("at least eight characters, typed the same twice", () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(passwordProblem("abc1234", "abc1234", null)).toContain("at least 8");
    expect(passwordProblem("abcd1234", "abcd1235", null)).toBe("The two passwords do not match.");
    expect(passwordProblem("abcd1234", "abcd1234", "pat@example.com")).toBeNull();
  });
  it("not the email address or the name in front of it, not all spaces, not endless", () => {
    expect(
      passwordProblem("Pat.Lee@Example.com", "Pat.Lee@Example.com", "pat.lee@example.com"),
    ).toBe("Choose a password that is not your email address.");
    expect(passwordProblem("PAT.LEEX", "PAT.LEEX", "pat.leex@example.com")).toBe(
      "Choose a password that is not your email address.",
    );
    expect(passwordProblem("         ", "         ", null)).toContain("all spaces");
    expect(passwordProblem("x".repeat(201), "x".repeat(201), null)).toContain("200");
  });
  it("the service's refusals in plain words", () => {
    expect(passwordUpdateError({ status: 422, code: "same_password" })).toContain(
      "your current password",
    );
    expect(passwordUpdateError({ status: 422, code: "weak_password" })).toContain("too easy");
    expect(passwordUpdateError({ status: 401 })).toBe(RESET_LINK_DEAD_TEXT);
    expect(passwordUpdateError({ status: 403, code: "session_not_found" })).toBe(
      RESET_LINK_DEAD_TEXT,
    );
    expect(passwordUpdateError({ message: "Auth session missing!" })).toBe(RESET_LINK_DEAD_TEXT);
    expect(passwordUpdateError({ status: 500 })).toBe(RESET_UNREACHABLE_TEXT);
    expect(passwordUpdateError({ status: 400, code: "something_new" })).toContain("not saved");
  });
  it("the sign-in screen is told once that the password was changed", () => {
    expect(takeResetDone()).toBe(false);
    markResetDone();
    expect(takeResetDone()).toBe(true);
    expect(takeResetDone()).toBe(false);
  });
});

describe("the sign-in screen", () => {
  const login = read("src/routes/login.tsx");
  it("has Forgot password, and sends the link back to this site's reset page only", () => {
    expect(login).toContain("Forgot password?");
    expect(login).toContain("supabase.auth.resetPasswordForEmail(email.trim(), {");
    expect(login).toContain("redirectTo: `${window.location.origin}/reset-password`,");
  });
  it("says the same thing after every request the service took", () => {
    expect(login).toContain("outcome = resetRequestOutcome(resetError);");
    expect(login).toContain("{RESET_SENT_TEXT}");
    expect(login).not.toMatch(/No account|not found|does not exist|no user/i);
  });
  it("rests after a send and says so on the button", () => {
    expect(login).toContain("setResendIn(RESET_RESEND_WAIT_S);");
    expect(login).toContain("disabled={sending || resendIn > 0}");
    expect(login).toContain("`Send again in ${resendIn}s`");
  });
});

describe("the reset page", () => {
  const page = read("src/routes/reset-password.tsx");
  it("saves through the session the link gave, then ends every session and asks to sign in", () => {
    const save = page.indexOf("supabase.auth.updateUser({ password })");
    const out = page.indexOf('supabase.auth.signOut({ scope: "global" })');
    const go = page.indexOf('void navigate({ to: "/login" });', out);
    expect(save).toBeGreaterThan(0);
    expect(out).toBeGreaterThan(save);
    expect(go).toBeGreaterThan(out);
    expect(page).toContain("markResetDone();");
  });
  it("checks the password with the page's own rules, in the page's own words", () => {
    expect(page).toContain("const problem = passwordProblem(password, confirm, email);");
    expect(page).toContain("setError(passwordUpdateError(updateError));");
    expect(page).not.toContain("minLength={PASSWORD_MIN}");
  });
  it("walking away from a reset signs the tab out", () => {
    expect(page).toContain('if (recovery === "pending")');
    expect(page).toContain('await supabase.auth.signOut({ scope: "local" })');
  });
  it("a refused link, or a reset with no sign-in behind it, is a dead link", () => {
    expect(page).toContain(
      'if (recovery === "refused" || (recovery === "pending" && !loading && !session)) {',
    );
    expect(page).toContain("{RESET_LINK_DEAD_TEXT}");
  });
  it("is a real route, open to every signed-in user and to nobody's menu", () => {
    expect(page).toContain('createFileRoute("/reset-password")');
    expect(pageForPath("/reset-password")).toBeNull();
    expect(read("src/routeTree.gen.ts")).toContain("'/reset-password'");
  });
});

describe("the gate and the first moment of the page", () => {
  const gate = read("src/components/auth-gate.tsx");
  const ctx = read("src/lib/auth-context.tsx");
  it("the link is noted before the sign-in client can read and wipe the address", () => {
    const note = ctx.indexOf(
      'if (typeof window !== "undefined") noteRecoveryArrival(window.location, window.sessionStorage);',
    );
    expect(note).toBeGreaterThan(0);
    expect(note).toBeLessThan(ctx.indexOf("export function AuthProvider"));
    expect(ctx).toContain(
      'if (event === "PASSWORD_RECOVERY") setRecoveryState(window.sessionStorage, "pending");',
    );
  });
  it("a tab in a reset is kept on the reset page, wherever the link landed", () => {
    expect(gate).toMatch(
      /if \(recovery && !isReset\) \{\s*navigate\(\{ to: "\/reset-password" \}\);\s*return;\s*\}/,
    );
    expect(gate).toContain("if (recovery && !isReset) return <Waiting />;");
  });
  it("the reset page is bare and needs no session; every other page still does", () => {
    expect(gate).toContain("if (isLogin || isReset) return <>{children}</>;");
    expect(gate).toContain("if (!session && !isLogin && !isReset) {");
  });
});
