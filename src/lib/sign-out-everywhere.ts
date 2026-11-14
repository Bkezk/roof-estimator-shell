/**
 * "Sign out all devices" for one person, on Users & access (security audit, Nov 14).
 *
 * A device that signs in stays signed in until someone signs out on it, so a lost phone kept its
 * way in. An admin can now end every sign-in of one person. A device that is open at that moment
 * holds a pass good for up to an hour and cannot renew it, so the words say "within the hour"
 * and never "at once". Removing the person is the instant cut.
 *
 * Pure: the wording. Tested in sign-out-everywhere-nov14c.test.ts.
 */
export const SIGN_OUT_ALL_LABEL = "Sign out all devices";

/** The button's name for a screen reader and its hover text. */
export function signOutAllTitle(name: string): string {
  return `${SIGN_OUT_ALL_LABEL} for ${name}`;
}

/** What the admin is asked before it happens. */
export function signOutAllConfirm(name: string, isSelf: boolean): string {
  const who = isSelf
    ? "Sign yourself out of every phone and computer, this one included?"
    : `Sign ${name} out of every phone and computer?`;
  const again = isSelf ? "You will have to sign in again." : "They will have to sign in again.";
  return `${who} ${again} A device that is open right now can keep working for up to an hour.`;
}

/** What the admin is told after: how many sign-ins were ended. */
export function signOutAllDone(name: string, devices: number): string {
  if (devices <= 0) return `${name} was not signed in anywhere.`;
  if (devices === 1) return `${name} is signed out of 1 device. It stops working within the hour.`;
  return `${name} is signed out of ${devices} devices. They stop working within the hour.`;
}
