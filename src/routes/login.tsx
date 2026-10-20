import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { SIGN_IN_STALL_MS } from "@/lib/auth-flow";
import { useAuth } from "@/lib/auth-store";
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
          <p className="mt-1 text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label htmlFor="password">Password</Label>
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
