/**
 * Reading rows by a list of ids, a chunk at a time (Oct 21, seventh audit, item G). A PostgREST
 * `.in("id", ids)` puts every id in the request URL. Work Overview's label lookups (customers,
 * buildings, opportunity statuses, ticket numbers) sent up to 1,000 ids in one read; past the
 * URL limit the read errors and, being best effort (`data ?? []`), every label on the page
 * silently went blank. `readInChunks` runs the read 100 ids at a time and merges the rows.
 *
 * Best effort is kept: a chunk that errors contributes nothing, the others still answer. The
 * merged rows come in chunk order; the callers key them by id, so order does not matter.
 */
export const ID_CHUNK = 100;

/** `ids` in runs of at most `size` (none for none). */
export function chunkIds(ids: readonly string[], size = ID_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

type ReadResult<T> = { data: T[] | null; error: unknown };

/** The rows `read` answers for every chunk of `ids`, merged; no read at all for no ids. */
export async function readInChunks<T>(
  ids: readonly string[],
  read: (chunk: string[]) => PromiseLike<ReadResult<T>>,
  size = ID_CHUNK,
): Promise<T[]> {
  const parts = await Promise.all(chunkIds(ids, size).map((chunk) => read(chunk)));
  return parts.flatMap((r) => (r.error ? [] : (r.data ?? [])));
}
