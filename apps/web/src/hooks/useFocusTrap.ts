import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Open traps, innermost last; only the innermost one handles Tab and Escape (dialogs can open dialogs). */
const openTraps: HTMLElement[] = [];

const focusableIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);

/**
 * While `active`, keeps Tab focus inside `ref`, calls `onEscape` on Escape, and moves focus into the
 * container (unless a child already took it, e.g. via autoFocus). Focus returns to the previously focused
 * element on deactivation. The container should have tabIndex={-1} as a focus fallback.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openTraps.push(container);
    if (!container.contains(document.activeElement)) (focusableIn(container)[0] ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (openTraps[openTraps.length - 1] !== container) return;
      if (e.key === "Escape") {
        if (onEscapeRef.current) {
          e.preventDefault();
          onEscapeRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = !container.contains(current);
      if (e.shiftKey && (current === first || current === container || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = openTraps.lastIndexOf(container);
      if (index >= 0) openTraps.splice(index, 1);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, ref]);
}
