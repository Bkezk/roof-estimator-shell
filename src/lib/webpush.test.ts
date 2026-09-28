import { describe, expect, it } from "vitest";

import {
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  toBase64,
  toBase64Url,
  vapidJwt,
} from "@/lib/webpush";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;
const concat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number) {
  const key = await subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
      key,
      bits,
    ),
  );
}

describe("web push on Web Crypto", () => {
  it("round-trips base64url and base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });

  it("makes a VAPID key pair and a JWT the public key verifies", async () => {
    const keys = await generateVapidKeys();
    expect(fromBase64Url(keys.publicKey)).toHaveLength(65);
    const jwt = await vapidJwt("https://fcm.googleapis.com", "mailto:test@example.com", keys);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(td.decode(fromBase64Url(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(td.decode(fromBase64Url(c)));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    const pub = await subtle.importKey(
      "raw",
      buf(fromBase64Url(keys.publicKey)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      buf(fromBase64Url(s)),
      buf(te.encode(`${h}.${c}`)),
    );
    expect(ok).toBe(true);
  });

  it("encrypts so the browser's side of RFC 8291 decrypts it", async () => {
    // The user agent's subscription keys.
    const ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    const uaPublic = new Uint8Array(await subtle.exportKey("raw", ua.publicKey));
    const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: "Follow up", body: "Ticket #6001", url: "/service" });
    const body = await encryptPayload(
      { p256dh: toBase64Url(uaPublic), auth: toBase64Url(auth) },
      te.encode(message),
    );
    // Parse the aes128gcm header.
    const salt = body.subarray(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    const idlen = body[20]!;
    const serverPublic = body.subarray(21, 21 + idlen);
    const cipher = body.subarray(21 + idlen);
    expect(rs).toBe(4096);
    expect(idlen).toBe(65);
    // Derive the same keys from the UA side.
    const serverKey = await subtle.importKey(
      "raw",
      buf(serverPublic),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const shared = new Uint8Array(
      await subtle.deriveBits({ name: "ECDH", public: serverKey }, ua.privateKey, 256),
    );
    const ikm = await hkdf(
      auth,
      shared,
      concat(te.encode("WebPush: info\0"), uaPublic, serverPublic),
      256,
    );
    const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 128);
    const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 96);
    const aes = await subtle.importKey("raw", buf(cek), "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(
      await subtle.decrypt({ name: "AES-GCM", iv: buf(nonce), tagLength: 128 }, aes, buf(cipher)),
    );
    expect(plain[plain.length - 1]).toBe(2);
    expect(td.decode(plain.subarray(0, plain.length - 1))).toBe(message);
  });
});
