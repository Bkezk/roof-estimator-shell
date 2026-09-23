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

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
