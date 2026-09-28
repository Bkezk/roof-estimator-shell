import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import { getNotifyPrefs, sendTestNotification, setNotifyPrefs } from "@/lib/followups.functions";
import {
  IOS_INSTALL_HINT,
  disablePushHere,
  enablePush,
  iosNeedsInstall,
  pushStateHere,
  type PushState,
} from "@/lib/push-client";
import { NOTIFICATIONS_QUERY_KEY } from "@/components/notifications-bell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — JBK Portal" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { profile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("Password updated");
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Signed in as {profile?.email}</p>
      </div>
      <NotificationsCard />
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Use at least 8 characters. Choose something only you know.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const PREFS_KEY = ["notify-prefs"] as const;
type Prefs = { notify_email: boolean; notify_push: boolean; devices: number };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function devicesLine(n: number) {
  if (n === 0) return "No devices have push on yet.";
  return n === 1 ? "1 device has push on." : `${n} devices have push on.`;
}

/** Reminder channels for the signed-in user, and web push on this particular device. */
function NotificationsCard() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getNotifyPrefs);
  const setFn = useServerFn(setNotifyPrefs);
  const testFn = useServerFn(sendTestNotification);

  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: () => getFn(), enabled: !!session });

  const save = useMutation({
    mutationFn: (patch: { notify_email?: boolean; notify_push?: boolean }) =>
      setFn({ data: patch }),
    onMutate: (patch) => {
      const before = qc.getQueryData<Prefs>(PREFS_KEY);
      if (before) qc.setQueryData<Prefs>(PREFS_KEY, { ...before, ...patch });
      return { before };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(PREFS_KEY, ctx.before);
      toast.error(errText(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });

  // Push on THIS device — only knowable in the browser, so it starts unknown (null).
  const [here, setHere] = useState<PushState | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshHere = useCallback(async () => {
    setNeedsInstall(iosNeedsInstall());
    setHere(await pushStateHere());
  }, []);
  useEffect(() => {
    void refreshHere();
  }, [refreshHere]);

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      if (prefs.data && !prefs.data.notify_push) await setFn({ data: { notify_push: true } });
      toast.success("Notifications are on for this device");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
      await refreshHere();
      void qc.invalidateQueries({ queryKey: PREFS_KEY });
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePushHere();
      toast.success("Notifications are off for this device");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
      await refreshHere();
      void qc.invalidateQueries({ queryKey: PREFS_KEY });
    }
  };

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => {
      if (r.email_configured) {
        toast.success("Test sent", {
          description: "Check the bell, your email and this device's notifications.",
        });
      } else {
        toast.warning(
          "Email is not set up yet (RESEND_API_KEY); the in-app and push copies were sent",
        );
      }
    },
    onError: (e) => toast.error(errText(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  const p = prefs.data;
  const hereText: Record<PushState, string> = {
    unsupported: "This browser cannot receive push notifications.",
    denied:
      "Notifications are blocked for this site. Allow them in the browser's site settings, then reload this page.",
    off: "Push is off on this device.",
    on: "Push is on for this device.",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Follow-up reminders always appear under the bell. Choose where else they reach you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {prefs.isError ? (
          <p className="text-sm text-destructive">{errText(prefs.error)}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="notify-email">Email reminders</Label>
                <p className="text-xs text-muted-foreground">Sent to your sign-in address.</p>
              </div>
              <Switch
                id="notify-email"
                checked={p?.notify_email ?? false}
                disabled={!p}
                onCheckedChange={(v) => save.mutate({ notify_email: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="notify-push">Push reminders</Label>
                <p className="text-xs text-muted-foreground">
                  To every device where you turn notifications on.
                </p>
              </div>
              <Switch
                id="notify-push"
                checked={p?.notify_push ?? false}
                disabled={!p}
                onCheckedChange={(v) => save.mutate({ notify_push: v })}
              />
            </div>
          </>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">This device</p>
          {here === null ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : needsInstall && here !== "on" ? (
            <p className="text-sm text-muted-foreground">{IOS_INSTALL_HINT}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{hereText[here]}</p>
          )}
          {here === "on" && p && !p.notify_push && (
            <p className="text-xs text-muted-foreground">
              Push reminders are off above, so this device will not receive them.
            </p>
          )}
          {here === "off" && !needsInstall && (
            <Button size="sm" onClick={() => void turnOn()} disabled={busy}>
              {busy ? "Turning on…" : "Turn on notifications on this device"}
            </Button>
          )}
          {here === "on" && (
            <Button size="sm" variant="outline" onClick={() => void turnOff()} disabled={busy}>
              {busy ? "Turning off…" : "Turn off on this device"}
            </Button>
          )}
          {p && <p className="text-xs text-muted-foreground">{devicesLine(p.devices)}</p>}
        </div>

        <Button
          variant="outline"
          onClick={() => test.mutate()}
          disabled={test.isPending || !session}
        >
          {test.isPending ? "Sending…" : "Send me a test"}
        </Button>
      </CardContent>
    </Card>
  );
}
