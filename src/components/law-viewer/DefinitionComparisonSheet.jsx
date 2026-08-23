import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DefinitionComparisonPanel } from "./DefinitionComparisonPanel.jsx";

// The comparison panel lives in the sidebar (LawViewerContextRail) on wide
// screens; below the xl breakpoint it becomes this bottom sheet instead. Keep
// the sheet out of the DOM entirely on wide screens — a display:none dialog
// with aria-modal="true" would still make the reader defer its arrow/j-k keys
// to it (querySelector matches hidden elements).
const SHEET_MEDIA_QUERY = "(max-width: 1279.98px)";

function matchesSheetQuery() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(SHEET_MEDIA_QUERY).matches
    : false;
}

export function DefinitionComparisonSheet(props) {
  const sheetRef = useRef(null);
  const { term, onClose } = props;
  const [isSheet, setIsSheet] = useState(matchesSheetQuery);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(SHEET_MEDIA_QUERY);
    const handleChange = (event) => setIsSheet(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!term || !isSheet) return undefined;
    const previousFocus = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sheetRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || [])];
      if (focusable.length === 0) {
        event.preventDefault();
        sheetRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => sheetRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onClose, term, isSheet]);

  if (!term || !isSheet || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end bg-black/25"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.t("definitionComparison.dialogLabel", { term })}
        tabIndex={-1}
        className="max-h-[78vh] w-full overflow-hidden rounded-t-2xl border-t border-gray-200 bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        <DefinitionComparisonPanel {...props} compact />
      </div>
    </div>,
    document.body
  );
}
