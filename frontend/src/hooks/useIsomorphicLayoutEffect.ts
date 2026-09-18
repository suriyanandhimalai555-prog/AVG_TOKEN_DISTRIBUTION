import { useEffect, useLayoutEffect } from "react";

/** Runs `useLayoutEffect` in the browser; `useEffect` on the server (no-op for static prerender). */
export const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;
