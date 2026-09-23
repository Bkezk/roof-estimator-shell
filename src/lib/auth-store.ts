/**
 * The auth context object and hook live apart from the provider component so a hot reload of
 * the provider file never mints a new context while the mounted tree still holds the old one
 * ("useAuth must be used within AuthProvider" after an edit).
 */
import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

import type { UserProfile } from "@/lib/auth.functions";
import type { Page } from "@/lib/access";

export interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  role: "admin" | "user" | null;
  /** May this user open the page? Admins always; users by their granted pages. */
  can: (page: Page) => boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// One context object per page load, whatever Vite hot-swaps: a re-evaluation of THIS file (an
// edit to it, or to anything it imports) must not mint a second context, or every mounted
// useAuth throws until a full reload. Pinned on globalThis for that reason only.
const g = globalThis as { __bidOMaticAuthContext?: ReturnType<typeof createAuthContext> };
function createAuthContext() {
  return createContext<AuthState | undefined>(undefined);
}
export const AuthContext = (g.__bidOMaticAuthContext ??= createAuthContext());

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Dispatched on window when any query fails with an Unauthorized server-function error. */
export const UNAUTHORIZED_EVENT = "bid-o-matic:unauthorized";
