/**
 * Setup's forms and the page (owner, Nov 4, review item 1): each editable card on /setup tells
 * the page whether it has unsaved edits and how to save them, so the page can mark the tab, ask
 * before the user leaves (Stay / Leave without saving / Save and leave) and save every dirty
 * card at once. The cards keep their own state; the page only reads it. A card rendered outside
 * the page (no provider) registers with nobody.
 */
import { createContext, useContext, useEffect } from "react";

export interface SetupForm {
  /** Unsaved edits. */
  dirty: boolean;
  /** Save them; resolves when the server has answered (rejects on failure). */
  save: () => Promise<unknown>;
}
export interface SetupFormsRegistry {
  register: (key: string, form: SetupForm) => void;
  unregister: (key: string) => void;
}

export const SetupFormsContext = createContext<SetupFormsRegistry | null>(null);

/** A card's hook: registers its current dirty state and save; unregisters when it unmounts. */
export function useSetupForm(key: string, dirty: boolean, save: () => Promise<unknown>) {
  const registry = useContext(SetupFormsContext);
  useEffect(() => {
    if (!registry) return;
    registry.register(key, { dirty, save });
  });
  useEffect(() => {
    if (!registry) return;
    return () => registry.unregister(key);
  }, [registry, key]);
}

/** The tab a form key belongs to ("vehicle:<id>" → "vehicles"; a plain key is its tab). */
export const tabOfFormKey = (key: string): string => key.split(":")[0] ?? key;

/**
 * Leaving /setup with unsaved edits is what the dialog guards; a tab switch stays on /setup and
 * keeps every card mounted, so it never asks.
 */
export function shouldBlockLeaving(nextPathname: string, anyDirty: boolean): boolean {
  return anyDirty && nextPathname !== "/setup";
}
