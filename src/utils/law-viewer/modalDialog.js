// A modal dialog counts as "open on top of the reader" only when it is
// actually on screen. querySelector matches display:none elements, so a dialog
// hidden for the current breakpoint (e.g. the definition-comparison bottom
// sheet on wide screens) would otherwise keep the reader's arrow/j-k keys
// suppressed for no reason.
export function isModalDialogOpen() {
  if (typeof document === "undefined") return false;
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog) return false;
  // In a real browser a hidden dialog has no client rects; jsdom does no
  // layout (getClientRects is always empty), so fall back to the dialog's own
  // computed display/visibility there.
  if (dialog.getClientRects().length === 0) {
    const style = typeof window !== "undefined" ? window.getComputedStyle(dialog) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
}