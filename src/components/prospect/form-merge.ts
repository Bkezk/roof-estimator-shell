/**
 * The building detail form keeps what the person typed when the building's row is re-read
 * underneath it (the stage button patches the cache, adding a task or a roof refetches it, the
 * storm refresh invalidates it): a three-way merge per field.
 */

/**
 * `current` is the form, `base` the row it was last filled from, `next` the row just read: a
 * field the person has not changed (still equal to `base`) takes the new value; a field they
 * changed keeps their value.
 */
export function mergeEdits<T extends object>(base: T, current: T, next: T): T {
  const out = { ...next };
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (!Object.is(current[k], base[k])) out[k] = current[k];
  }
  return out;
}
