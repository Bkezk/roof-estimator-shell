/**
 * The bell's line about notifications on this device (lib/push-hint.ts has the rule and the
 * words). It also keeps the server's copy of this device current, once a day (push-client.ts
 * keepPushHere). Shows nothing until the device's state is known, so the page that the server
 * drew and the first draw in the browser are the same.
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setNotifyPrefs } from "@/lib/followups.functions";
import { enablePush, iosNeedsInstall, keepPushHere, type PushState } from "@/lib/push-client";
import { PUSH_HINT_OFF_KEY, pushHint } from "@/lib/push-hint";
import { Button } from "@/components/ui/button";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const readDismissed = () => {
  try {
    return window.localStorage.getItem(PUSH_HINT_OFF_KEY) === "1";
  } catch {
    return false;
  }
};

export function PushHereHint(props: { userId: string | null | undefined }) {
  const qc = useQueryClient();
  const setFn = useServerFn(setNotifyPrefs);
  const [state, setState] = useState<PushState | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    if (!props.userId) return;
    setNeedsInstall(iosNeedsInstall());
    setDismissed(readDismissed());
    setState(await keepPushHere(props.userId));
  }, [props.userId]);
  useEffect(() => {
    void read();
  }, [read]);

  const hint = pushHint(state, needsInstall, dismissed);
  if (!hint) return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      // The account's own push switch goes on with it, as My account's button does.
      await setFn({ data: { notify_push: true } });
      void qc.invalidateQueries({ queryKey: ["notify-prefs"] });
      toast.success("Notifications are on for this device");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
      await read();
    }
  };
  const notHere = () => {
    try {
      window.localStorage.setItem(PUSH_HINT_OFF_KEY, "1");
    } catch {
      /* private mode: the line comes back on the next load */
    }
    setDismissed(true);
  };

  return (
    <div className="space-y-2 border-b bg-muted/50 px-3 py-2" data-push-hint>
      <p className="flex items-start gap-2 text-xs">
        <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>{hint.text}</span>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          data-push-hint-dismiss
          onClick={notHere}
        >
          Not on this device
        </Button>
        {hint.canTurnOn && (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            data-push-hint-on
            disabled={busy}
            onClick={() => void turnOn()}
          >
            {busy && <Loader2 className="animate-spin" />}
            Turn on
          </Button>
        )}
      </div>
    </div>
  );
}
