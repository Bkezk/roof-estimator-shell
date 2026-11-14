import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { SIGN_IN_STALL_MS } from "@/lib/auth-flow";
import { useAuth } from "@/lib/auth-store";
import {
  RESET_BAD_EMAIL_TEXT,
  RESET_DONE_TEXT,
  RESET_RESEND_WAIT_S,
  RESET_SENT_TEXT,
  RESET_UNREACHABLE_TEXT,
  resetRequestOutcome,
  takeResetDone,
} from "@/lib/recovery-link";
import { StalledNotice } from "@/components/stalled-sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in — JBK Portal" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Forgot password (owner, Nov 14; lib/recovery-link.ts): the same card asks for the email and
  // has the sign-in service send a one-time link. What it says afterwards is the same whether or
  // not the email has an account. `notice`: the one line shown after a reset was finished.
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");
  const [sending, setSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [notice] = useState<string | null>(() => (takeResetDone() ? RESET_DONE_TEXT : null));
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || resendIn > 0) return;
    setError(null);
    setSending(true);
    let outcome: ReturnType<typeof resetRequestOutcome>;
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      outcome = resetRequestOutcome(resetError);
    } catch {
      outcome = "unreachable";
    }
    setSending(false);
    if (outcome === "sent") {
      setMode("sent");
      setResendIn(RESET_RESEND_WAIT_S);
    } else {
      setError(outcome === "invalid" ? RESET_BAD_EMAIL_TEXT : RESET_UNREACHABLE_TEXT);
    }
  };
  const toSignIn = () => {
    setError(null);
    setMode("signin");
  };

  // Signed in — just now, or already when the screen opened: the AuthGate sends the person to
  // their home (homeFor: Work Overview, My tickets for a technician-only user) once their profile
  // has loaded. This page used to navigate to /bids on its own as well (Oct 20): two competing
  // navigations, the wrong one for a technician. Until the gate moves, the button stays busy.
  const leaving = !!session;
  // Oct 20: a profile read that never settles left the button "Signing in…" for good (the gate
  // renders this page bare, before its Waiting and its notice): after the same wait as the
  // gate's (SIGN_IN_STALL_MS), the same way out — Reload / Sign in again.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!leaving) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), SIGN_IN_STALL_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setSubmitting(false);
      // A rejected password comes back as HTTP 400; anything else (no network, a blocked host,
      // a 5xx) is not the user's fault and must not read as a wrong password.
      const status = (signInError as { status?: number }).status;
      setError(
        status === 400
          ? "Incorrect email or password."
          : "Could not reach the sign-in service — check your connection and try again.",
      );
      return;
    }
    // Signed in: the gate takes it from here (the session arrives through onAuthStateChange).
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">JBK Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to continue" : "Reset your password"}
          </p>
        </div>
        {mode === "forgot" && (
          <form onSubmit={sendReset} className="space-y-4" data-form="forgot">
            <p className="text-sm text-muted-foreground">
              Enter the email you sign in with. We will email you a link to set a new password.
            </p>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {/* Resting after a send: said on the button, never a click that does nothing. */}
            <Button type="submit" className="w-full" disabled={sending || resendIn > 0}>
              {sending
                ? "Sending…"
                : resendIn > 0
                  ? `Send again in ${resendIn}s`
                  : "Email me a reset link"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={toSignIn}>
              Back to sign in
            </Button>
          </form>
        )}
        {mode === "sent" && (
          <div className="space-y-4" data-form="reset-sent">
            <p className="text-sm" role="status">
              {RESET_SENT_TEXT}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={resendIn > 0}
              onClick={() => setMode("forgot")}
            >
              {resendIn > 0 ? `Send again in ${resendIn}s` : "Send again"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={toSignIn}>
              Back to sign in
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              No email? An administrator can also set a new password for you.
            </p>
          </div>
        )}
        {mode === "signin" && notice && (
          <p
            className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
            role="status"
            data-row="reset-done"
          >
            {notice}
          </p>
        )}
        <form
          onSubmit={handleSubmit}
          className={mode === "signin" ? "space-y-4" : "hidden"}
          data-form="signin"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                data-action="forgot-password"
                onClick={() => {
                  setError(null);
                  setMode("forgot");
                }}
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting || leaving}>
            {submitting || leaving ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        {leaving && stalled && (
          <div className="mt-4 flex flex-col items-center gap-3 text-center" data-row="stalled">
            <StalledNotice />
          </div>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
