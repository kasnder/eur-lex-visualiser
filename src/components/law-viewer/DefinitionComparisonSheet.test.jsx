import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefinitionComparisonSheet } from "./DefinitionComparisonSheet.jsx";

let container;
let root;
let matchMediaListeners;

function t(key) {
  return key;
}

// jsdom has no matchMedia; fake it so the component can pick sheet vs nothing.
function mockMatchMedia(matches) {
  matchMediaListeners = [];
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: (_type, listener) => matchMediaListeners.push(listener),
    removeEventListener: (_type, listener) => {
      matchMediaListeners = matchMediaListeners.filter((entry) => entry !== listener);
    },
  }));
}

function fireMatchMediaChange(matches) {
  act(() => {
    for (const listener of matchMediaListeners) listener({ matches });
  });
}

function renderSheet(props = {}) {
  act(() => {
    root.render(
      <DefinitionComparisonSheet
        term="systemic risk"
        onClose={() => {}}
        t={t}
        {...props}
      />
    );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DefinitionComparisonSheet below the xl breakpoint", () => {
  beforeEach(() => mockMatchMedia(true));

  it("renders the bottom sheet with an aria-modal dialog", () => {
    renderSheet();

    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("systemic risk");
  });
});

describe("DefinitionComparisonSheet at the xl breakpoint and wider", () => {
  beforeEach(() => mockMatchMedia(false));

  it("renders nothing, so the reader's modal-dialog check stays clear", () => {
    renderSheet();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not leak an aria-modal dialog into the DOM when the viewport widens", () => {
    mockMatchMedia(true);
    renderSheet();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    fireMatchMediaChange(false);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});