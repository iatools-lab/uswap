import type { MouseEvent } from "react";
import type { NavigateFunction } from "react-router-dom";

export function interceptNav(
  event: MouseEvent<HTMLAnchorElement>,
  navigate: NavigateFunction,
  target: string,
) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return false;
  event.preventDefault();
  navigate(target);
  window.scrollTo({ top: 0, behavior: "instant" });
  return true;
}
