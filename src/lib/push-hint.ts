/**
 * What the bell says about notifications on THIS device (owner, Nov 17: "someone tagged me in a
 * note and it didnt come up as a notification on my phone"; and the managers are to hear every
 * ticket step). A notice reaches a phone only when that phone has notifications turned on, and
 * until now the only place that said so was My account: six of the eight people had never turned
 * a device on, and nothing told them.
 *
 * Pure: the words and whether there is a button. The bell (components/push-here-hint.tsx) reads
 * the device's state and shows this. A person who does not want notifications on a device says
 * "Not on this device" once, and the line stays away there (PUSH_HINT_OFF_KEY, per device).
 */
import type { PushState } from "@/lib/push-client";

/** localStorage: "1" once the person has said not on this device. */
export const PUSH_HINT_OFF_KEY = "jbk-push-hint-off";

export interface PushHint {
  text: string;
  /** A "Turn on" button: the device can take notifications and has not been asked, or said no once. */
  canTurnOn: boolean;
}

export const PUSH_HINT_OFF =
  "This device does not get notifications yet. Turn them on to hear about mentions, assignments and reminders here.";
export const PUSH_HINT_BLOCKED =
  "Notifications are blocked for this site on this device. Allow them in the browser's site settings, then reload.";
export const PUSH_HINT_IPHONE =
  "To get notifications on this iPhone, add JBK Portal to your Home Screen (Share, then Add to Home Screen) and open it from there.";

/**
 * The line to show, or null for none: the device is on, cannot take notifications at all, its
 * state is not known yet, or the person said not here.
 */
export function pushHint(
  state: PushState | null,
  needsInstall: boolean,
  dismissed: boolean,
): PushHint | null {
  if (dismissed || state === null || state === "on") return null;
  // An iPhone or iPad in a Safari tab: it can, but only from the Home Screen app.
  if (needsInstall) return { text: PUSH_HINT_IPHONE, canTurnOn: false };
  if (state === "off") return { text: PUSH_HINT_OFF, canTurnOn: true };
  if (state === "denied") return { text: PUSH_HINT_BLOCKED, canTurnOn: false };
  return null;
}
