/**
 * Minimal ZIP reader for legacy Bid-Advantage `.bax` files (a zip holding one `EstimateData`
 * entry, stored or plain-deflate). No dependency: the central directory is walked by hand and
 * deflate goes through the platform's `DecompressionStream("deflate-raw")`, which every current
 * browser and Node 18+ provide. Only what a .bax needs is supported (no encryption, no data
 * descriptors beyond what the central directory already states). Bid-Advantage writes the
 * entry through .NET's packaging layer, which puts 0xFFFFFFFF in the 32-bit size fields and the
 * real sizes in a zip64 extra field — those are read, because handing the decompressor the
 * rest of the file (deflate data + central directory) is "Failed to fetch" in Chrome, which
 * refuses trailing junk, while Node's inflate quietly ignores it.
 */

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** List the entries named in the central directory. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  // End-of-central-directory record: scan back from the end (a trailing comment may follow it).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL)
      throw new Error("Corrupt zip central directory.");
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const entry: ZipEntry = { name, method, compressedSize, uncompressedSize, localHeaderOffset };
    applyZip64(dv, p + 46 + nameLen, extraLen, entry);
    entries.push(entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const ZIP64_MARK = 0xffffffff;
const EXTRA_ZIP64 = 0x0001;

/**
 * Replace 0xFFFFFFFF size / offset fields with the 64-bit values from the zip64 extended
 * information extra field (APPNOTE 4.5.3). Only the fields marked 0xFFFFFFFF are present, in
 * this order: uncompressed size, compressed size, local header offset.
 */
function applyZip64(dv: DataView, extraStart: number, extraLen: number, e: ZipEntry): void {
  if (
    e.compressedSize !== ZIP64_MARK &&
    e.uncompressedSize !== ZIP64_MARK &&
    e.localHeaderOffset !== ZIP64_MARK
  )
    return;
  let q = extraStart;
  const end = extraStart + extraLen;
  while (q + 4 <= end) {
    const id = dv.getUint16(q, true);
    const len = dv.getUint16(q + 2, true);
    if (id === EXTRA_ZIP64) {
      let f = q + 4;
      const fieldEnd = Math.min(end, q + 4 + len);
      const take = (): number | null => {
        if (f + 8 > fieldEnd) return null;
        const v = Number(dv.getBigUint64(f, true));
        f += 8;
        return v;
      };
      if (e.uncompressedSize === ZIP64_MARK) e.uncompressedSize = take() ?? e.uncompressedSize;
      if (e.compressedSize === ZIP64_MARK) e.compressedSize = take() ?? e.compressedSize;
      if (e.localHeaderOffset === ZIP64_MARK) e.localHeaderOffset = take() ?? e.localHeaderOffset;
      return;
    }
    q += 4 + len;
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!DS) throw new Error("This browser cannot unzip files (no DecompressionStream).");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Read one entry's bytes (stored or deflated). */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const dv = view(bytes);
  const p = entry.localHeaderOffset;
  if (p + 30 > bytes.length || dv.getUint32(p, true) !== SIG_LOCAL)
    throw new Error(`Corrupt zip entry "${entry.name}".`);
  const nameLen = dv.getUint16(p + 26, true);
  const extraLen = dv.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  if (entry.compressedSize === ZIP64_MARK || start + entry.compressedSize > bytes.length)
    throw new Error(`Corrupt zip entry "${entry.name}" (size unknown).`);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Unsupported zip compression method ${entry.method} in "${entry.name}".`);
}

/** The `EstimateData` XML text inside a .bax file. */
export async function readBaxXml(bytes: Uint8Array): Promise<string> {
  const entries = listZipEntries(bytes);
  const entry =
    entries.find((e) => e.name === "EstimateData") ??
    entries.find((e) => /estimatedata$/i.test(e.name)) ??
    entries.find((e) => !e.name.endsWith("/"));
  if (!entry) throw new Error("The file has no EstimateData entry — is it a .bax file?");
  const data = await readZipEntry(bytes, entry);
  // Legacy writes UTF-8 (the "-∞" markup sentinel shows up as UTF-8 bytes).
  return new TextDecoder("utf-8").decode(data);
}
