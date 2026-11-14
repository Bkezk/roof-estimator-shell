import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  markResetDone,
  onRecoveryChange,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  passwordUpdateError,
  recoveryState,
  RESET_LINK_DEAD_TEXT,
  setRecoveryState,
} from "@/lib/recovery-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Set a new password (owner, Nov 14). The link in the reset email opens this page; the sign-in
 * service has already checked the link (one use, limited time) and signed this tab in as that
 * person for the one purpose of choosing a password. Rules and wording: lib/recovery-link.ts.
 *
 * After the password is saved every session of that person is ended, on every device, and they
 * sign in again with the new password: whoever else might have been signed in as them is out,
 * and the person has proven they know what they just typed.
 *
 * Bare like the sign-in screen (components/auth-gate.tsx): no menu, no app pages. While a reset
 * is under way the gate keeps this tab here.
 */
export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Set a new password — JBK Portal" }],
  }),
  component: ResetPasswordPage,
});

const tabStore = () => (typeof window === "undefined" ? null : window.sessionStorage);

function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const recovery = useSyncExternalStore(
    onRecoveryChange,
    () => recoveryState(tabStore()),
    () => null,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const email = session?.user.email ?? null;

  const backToSignIn = async () => {
    setRecoveryState(tabStore(), null);
    // A reset that is walked away from leaves nobody signed in on this device.
    if (recovery === "pending")
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    void navigate({ to: session && recovery !== "pending" ? "/" : "/login" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm, email);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSaving(false);
      setError(passwordUpdateError(updateError));
      return;
    }
    // Saved. End every session of this person, everywhere; then they sign in with it.
    setPassword("");
    setConfirm("");
    markResetDone();
    setRecoveryState(tabStore(), null);
    const out = await supabase.auth.signOut({ scope: "global" }).catch((e: unknown) => ({
      error: e,
    }));
    if (out.error) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    setSaving(false);
    void navigate({ to: "/login" });
  };

  let body: React.ReactNode;
  if (recovery === "refused" || (recovery === "pending" && !loading && !session)) {
    body = (
      <div className="space-y-4 text-center" data-state="dead-link">
        <p className="text-sm text-destructive">{RESET_LINK_DEAD_TEXT}</p>
        <Button className="w-full" onClick={() => void backToSignIn()}>
          Back to sign in
        </Button>
      </div>
    );
  } else if (recovery === "pending" && !session) {
    body = (
      <p
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        data-state="checking"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
      </p>
    );
  } else if (recovery === "pending") {
    body = (
      <form onSubmit={handleSubmit} className="space-y-4" data-state="form">
        {email && (
          <p className="text-sm text-muted-foreground">
            For <span className="font-medium text-foreground">{email}</span>
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // No minLength here: the page's own plain message says it (passwordProblem), not
              // the browser's bubble.
              maxLength={PASSWORD_MAX}
              className="pr-10"
              required
              autoFocus
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide the password" : "Show the password"}
              title={show ? "Hide the password" : "Show the password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN} characters.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Type it again</Label>
          <Input
            id="confirm-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            maxLength={PASSWORD_MAX}
            required
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Saving…" : "Save new password"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={saving}
          onClick={() => void backToSignIn()}
        >
          Cancel
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Saving signs you out everywhere. You then sign in with the new password.
        </p>
      </form>
    );
  } else {
    // Opened by hand, with no reset under way.
    body = (
      <div className="space-y-4 text-center" data-state="no-link">
        <p className="text-sm text-muted-foreground">
          To set a new password, open the link in your reset email. To get one, go to the sign-in
          screen and choose Forgot password.
        </p>
        <Button className="w-full" onClick={() => void backToSignIn()}>
          {session ? "Back to the portal" : "Back to sign in"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">JBK Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">Set a new password</p>
        </div>
        {body}
      </div>
    </div>
  );
}
