import { useEffect, useState } from "react";

import { PHONE_BOARD_QUERY } from "@/lib/board-phone";

/**
 * Is this the phone board's kind of screen (lib/board-phone.ts PHONE_BOARD_QUERY)? `undefined`
 * until the browser has answered: the server cannot know, so the board waits rather than drawing
 * the desk grid for a moment on a phone.
 */
export function usePhoneBoard(): boolean | undefined {
  const [phone, setPhone] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mql = window.matchMedia(PHONE_BOARD_QUERY);
    const read = () => setPhone(mql.matches);
    read();
    mql.addEventListener("change", read);
    return () => mql.removeEventListener("change", read);
  }, []);
  return phone;
}
