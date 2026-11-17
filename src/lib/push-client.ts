/**
 * Web push on this device — BROWSER ONLY (every export is a no-op or "unsupported" during SSR).
 *
 * The service worker is the static file public/sw.js (show a notification on push, focus or open
 * the app on click; no fetch handler, no caching). The server side — VAPID keys, the subscription
 * rows, delivery — is in followups.functions.ts / notify.server.ts.
 */
import {
  getPushPublicKey,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/followups.functions";

export type PushState = "unsupported" | "denied" | "off" | "on";

const SW_URL = "/sw.js";

/** Shown on an iPhone / iPad that is not running the installed (Home Screen) app. */
export const IOS_INSTALL_HINT =
  "On iPhone, add JBK Portal to your Home Screen (Share → Add to Home Screen) and open it from there to turn on notifications.";

const inBrowser = () => typeof window !== "undefined" && typeof navigator !== "undefined";

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(): boolean {
  if (!inBrowser()) return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** iOS only delivers web push to the app opened from the Home Screen, not to a Safari tab. */
export function iosNeedsInstall(): boolean {
  if (!isIos()) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return !standalone;
}

export function pushSupported(): boolean {
  return (
    inBrowser() &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Register /sw.js once per page load (safe to call often). Resolves null where service workers
 * are unavailable (SSR, http:, old browsers) or registration fails — never throws.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!inBrowser() || !window.isSecureContext || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  registering ??= navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch((e: unknown) => {
    console.warn("Service worker registration failed", e);
    registering = null;
    return null;
  });
  return registering;
}

/** VAPID keys are base64url; PushManager.subscribe wants the raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Push on this device, for the signed-in user. */
export async function pushStateHere(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  try {
    return (await currentSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

/**
 * Turn push on here: register the worker, ask permission, subscribe with the server's VAPID key
 * and store the subscription for the signed-in user. Call it from a click (browsers — Safari
 * especially — only show the permission prompt in response to a user gesture). Throws a readable
 * Error when it cannot.
 */
export async function enablePush(): Promise<void> {
  if (iosNeedsInstall()) throw new Error(IOS_INSTALL_HINT);
  if (!pushSupported()) throw new Error("This browser cannot receive push notifications.");
  // Ask first, while the click's user activation is still fresh.
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new Error(
      "Notifications are blocked for this site. Allow them in the browser's site settings, then try again.",
    );
  }
  if (permission !== "granted") throw new Error("Notifications were not allowed.");

  const registered = await registerServiceWorker();
  if (!registered) throw new Error("Could not start the notification service on this device.");
  const reg = await navigator.serviceWorker.ready;

  const { publicKey } = await getPushPublicKey();
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older key can never be delivered to: replace it.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  const json = sub.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) throw new Error("The browser returned no push keys.");
  await savePushSubscription({
    data: {
      endpoint: json.endpoint,
      keys: { p256dh, auth },
      user_agent: navigator.userAgent.slice(0, 300),
    },
  });
}

/** Turn push off here: unsubscribe this browser and forget its subscription on the server. */
export async function disablePushHere(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await removePushSubscription({ data: { endpoint } });
}

/** localStorage: the day this device's subscription was last saved again, per person. */
const KEPT_KEY = "jbk-push-kept";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Keep the server's copy of this device current (owner, Nov 17: a mention that the server sent
 * and the phone never showed). A phone can change its push address or keys without telling the
 * site, and the server then sends to an address nothing listens on. Once a day, when the app is
 * opened on a device that has notifications on, the device's own address and keys are saved
 * again for the signed-in person (the same save "Turn on" makes; it also clears a "gone" mark).
 *
 * Never turns notifications on for a device that has them off: that is the person's own choice,
 * made with a click. Never throws; answers the state of push on this device.
 */
export async function keepPushHere(userId: string): Promise<PushState> {
  const state = await pushStateHere();
  if (state !== "on" || !userId) return state;
  try {
    const sub = await currentSubscription();
    const json = sub?.toJSON();
    const p256dh = json?.keys?.["p256dh"];
    const auth = json?.keys?.["auth"];
    if (!json?.endpoint || !p256dh || !auth) return state;
    const mark = `${userId}|${json.endpoint}|${today()}`;
    if (window.localStorage.getItem(KEPT_KEY) === mark) return state;
    await savePushSubscription({
      data: {
        endpoint: json.endpoint,
        keys: { p256dh, auth },
        user_agent: navigator.userAgent.slice(0, 300),
      },
    });
    window.localStorage.setItem(KEPT_KEY, mark);
  } catch (e) {
    console.warn("Could not refresh this device's notification details", e);
  }
  return state;
}
