/**
 * What the screen is (owner, Nov 3, the iPad): a coarse pointer (a finger) and a narrow window
 * (./touch.ts NARROW_PX). Both read after mount, so the server render and the first client
 * render agree (false), and both follow the window as it changes.
 */
import { useEffect, useState } from "react";

import { isNarrow } from "./touch";

/** True on a touch screen (`(pointer: coarse)`), false until mounted. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return coarse;
}

/** True while the window is narrower than NARROW_PX, false until mounted. */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const update = () => setNarrow(isNarrow(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return narrow;
}
