/**
 * Open or folded for one section of a customer's or a property's page (owner, Oct 15: "lets
 * make these collapsible so if there's 100 tickets it won't take up the whole page"): what this
 * user set last (the browser's copy, lib/customer-folds.ts), else the default for the count
 * (`count` null while the rows load). `toggle` flips it and remembers it. The header that calls
 * it is components/section-fold.tsx.
 */
import { useState } from "react";

import { useAuth } from "@/lib/auth-store";
import {
  isFoldOpen,
  readFolds,
  toggleFold,
  writeFolds,
  type FoldPage,
  type FoldSection,
} from "@/lib/customer-folds";

export function useSectionFold(
  page: FoldPage,
  section: FoldSection,
  count: number | null | undefined,
): { open: boolean; toggle: () => void } {
  const { session, profile } = useAuth();
  const userId = profile?.id ?? session?.user.id ?? "";
  const storage = typeof window === "undefined" ? null : window.localStorage;
  const [folds, setFolds] = useState(() => readFolds(storage, page, userId));
  const open = isFoldOpen(folds, section, count);
  const toggle = () => {
    // Re-read first: another section on the page wrote its own fold since this one was read.
    const next = toggleFold(readFolds(storage, page, userId), section, !open);
    setFolds(next);
    writeFolds(storage, page, userId, next);
  };
  return { open, toggle };
}
