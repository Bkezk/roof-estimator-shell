/**
 * Web Push without Node-only dependencies (owner's Sep 28 "buffer.hasOwnProperty is not a
 * function": the web-push package needs Node's Buffer / crypto, which the app's runtime lacks).
 * Everything here is Web Crypto + fetch, so it runs on Node 22 and on the edge runtime alike.
 *
 * Implements VAPID (RFC 8292: an ES256 JWT in the Authorization header) and the aes128gcm
 * message encryption (RFC 8291 / RFC 8188). Keys are in the same base64url form the web-push
 * package used, so stored keys keep working.
 */

const subtle = () => globalThis.crypto.subtle;
const te = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Plain base64 (for email attachments and downloads), chunked so big files don't blow the stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
// Web Crypto wants BufferSource; a copied ArrayBuffer sidesteps SharedArrayBuffer typing.
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

export interface VapidKeys {
  /** Uncompressed P-256 point (65 bytes), base64url. */
  publicKey: string;
  /** The private scalar (32 bytes), base64url. */
  privateKey: string;
}

/** A fresh VAPID pair (same encoding as web-push's generateVAPIDKeys). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pub = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
  const jwk = await subtle().exportKey("jwk", kp.privateKey);
  if (!jwk.d) throw new Error("Key export failed");
  return { publicKey: toBase64Url(pub), privateKey: jwk.d };
}

async function importVapidPrivate(keys: VapidKeys): Promise<CryptoKey> {
  const pub = fromBase64Url(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("VAPID public key is not a raw P-256 point");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(pub.subarray(1, 33)),
    y: toBase64Url(pub.subarray(33, 65)),
    d: keys.privateKey,
  };
  return subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The signed VAPID token for one push service origin (valid 12 hours). */
export async function vapidJwt(
  audience: string,
  subject: string,
  keys: VapidKeys,
): Promise<string> {
  const header = toBase64Url(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    te.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const key = await importVapidPrivate(keys);
  // Web Crypto's ECDSA signature is already the raw r||s (64 bytes) that JWS wants.
  const sig = new Uint8Array(
    await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(signingInput)),
  );
  return `${signingInput}.${toBase64Url(sig)}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number) {
  const key = await subtle().importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle().deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
      key,
      bits,
    ),
  );
}

/**
 * Encrypt a payload for a subscription (RFC 8291, aes128gcm): returns the request body
 * (salt ‖ rs ‖ idlen ‖ our public key ‖ ciphertext).
 */
export async function encryptPayload(
  sub: { p256dh: string; auth: string },
  payload: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = fromBase64Url(sub.p256dh);
  const authSecret = fromBase64Url(sub.auth);
  if (uaPublic.length !== 65) throw new Error("Subscription p256dh is not a raw P-256 point");
  const local = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const localPublic = new Uint8Array(await subtle().exportKey("raw", local.publicKey));
  const uaKey = await subtle().importKey(
    "raw",
    buf(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(te.encode("WebPush: info\0"), uaPublic, localPublic),
    256,
  );
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 96);
  const aes = await subtle().importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // One record: the payload plus the 0x02 "last record" delimiter (no extra padding).
  const plain = concat(payload, new Uint8Array([2]));
  const cipher = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: buf(nonce), tagLength: 128 }, aes, buf(plain)),
  );
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([localPublic.length]), localPublic, cipher);
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** 404 / 410: the subscription is dead and should be dropped. */
  gone: boolean;
  error?: string;
}

/** POST an encrypted, VAPID-signed message to the subscription's push service. */
export async function sendWebPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  opts: { keys: VapidKeys; subject: string; ttlSeconds?: number },
): Promise<PushResult> {
  const audience = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(audience, opts.subject, opts.keys);
  const body = await encryptPayload(sub, te.encode(payload));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${opts.keys.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      TTL: String(opts.ttlSeconds ?? 86400),
      Urgency: "normal",
    },
    body: buf(body),
  });
  const gone = res.status === 404 || res.status === 410;
  if (res.ok) return { ok: true, status: res.status, gone: false };
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, gone, error: `${res.status} ${text.slice(0, 200)}` };
}
