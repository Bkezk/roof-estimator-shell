/**
 * Who authorizes Done tickets when Setup › Service rates names nobody (QA audit bug 6; owner,
 * Oct 6): Brandon, Brandon@flatroofonline.com — not added as a user yet. The database does the
 * choosing (20261006210000_default_authorizer.sql: the set person → Brandon once he is an admin
 * or manager → every admin by created_at); this is the display side for the Setup picker.
 * The email never goes into a request; it is compared case-insensitively everywhere.
 */

/** Lower-cased, as the migration compares it. */
export const DEFAULT_AUTHORIZER_EMAIL = "brandon@flatroofonline.com";
/** As the owner wrote it, for display. */
export const DEFAULT_AUTHORIZER_SHOWN = "Brandon (Brandon@flatroofonline.com)";

export const isDefaultAuthorizerEmail = (email: string | null | undefined): boolean =>
  (email ?? "").trim().toLowerCase() === DEFAULT_AUTHORIZER_EMAIL;

export interface AuthorizerOption {
  id: string;
  name: string;
  email?: string | null;
}

/**
 * The help text under the picker when nothing is picked, else null: who the authorization falls
 * to — Brandon by name when a profile with his email is among the admins / managers
 * (`manager_options()`), otherwise that he is not a user yet and every admin gets it until then.
 */
export function authorizerFallbackLabel(
  settings: { authorizer_id: string | null | undefined } | null | undefined,
  people: readonly AuthorizerOption[],
): string | null {
  if (settings?.authorizer_id) return null;
  const brandon = people.find((p) => isDefaultAuthorizerEmail(p.email));
  return brandon
    ? `Default: ${brandon.name}`
    : `Default: ${DEFAULT_AUTHORIZER_SHOWN} — not added as a user yet; until then every admin`;
}
