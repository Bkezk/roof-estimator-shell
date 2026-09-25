/**
 * JSON.parse for map-server answers that are not quite JSON. The Kentucky address-point service
 * returns a raw control character inside a string for some records (Perry County, Sep 2026:
 * "Bad control character in string literal"), which JSON.parse rejects and which failed the
 * county on every run. Raw control characters are illegal inside JSON strings and, apart from
 * tab / newline / carriage return between tokens, never appear in valid JSON, so replacing every
 * one with a space cannot change a well-formed document.
 */
export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    // eslint-disable-next-line no-control-regex -- stripping raw control characters is the point
    const cleaned = text.replace(/[\u0000-\u001f]/g, " ");
    if (cleaned === text) throw e;
    return JSON.parse(cleaned);
  }
}
