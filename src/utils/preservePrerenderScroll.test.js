import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preservePrerenderScroll } from "./preservePrerenderScroll.js";

describe("preservePrerenderScroll", () => {
  let scrollY;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollY = 0;
    vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(callback, 0));
    vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
    vi.stubGlobal("scrollTo", vi.fn((_, nextY) => {
      scrollY = nextY;
    }));
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores the prerender position after the app replaces its DOM", async () => {
    const root = document.createElement("div");
    const stop = preservePrerenderScroll({ root, targetY: 480 });

    expect(window.scrollTo).not.toHaveBeenCalled();
    root.replaceChildren(document.createElement("main"));
    await vi.runAllTimersAsync();

    expect(window.scrollTo).toHaveBeenCalledWith(0, 480);
    expect(window.scrollY).toBe(480);
    stop();
  });

  it("does nothing when the prerender was not scrolled", async () => {
    const root = document.createElement("div");
    preservePrerenderScroll({ root, targetY: 0 });

    root.replaceChildren(document.createElement("main"));
    await vi.runAllTimersAsync();

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("stops before restoring when the user starts a new navigation gesture", async () => {
    const root = document.createElement("div");
    preservePrerenderScroll({ root, targetY: 480 });

    window.dispatchEvent(new Event("wheel"));
    root.replaceChildren(document.createElement("main"));
    await vi.runAllTimersAsync();

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
