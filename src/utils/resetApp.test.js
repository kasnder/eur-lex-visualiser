import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeFormexDb: vi.fn(),
}));

vi.mock("./formexApi.js", () => ({
  closeFormexDb: mocks.closeFormexDb,
}));

const { runOneTimeMigrationReset, isMigrationCurrent } = await import("./resetApp.js");

describe("application data reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // clearAllMocks keeps prior implementations; give every test a resolving
    // default so a leaked implementation from another test can't hang it.
    mocks.closeFormexDb.mockResolvedValue(undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("closes this tab's Formex connection before deleting its database", async () => {
    const calls = [];
    let finishClosing;
    mocks.closeFormexDb.mockImplementation(() => new Promise((resolve) => {
      calls.push("close");
      finishClosing = resolve;
    }));

    const deleteDatabase = vi.fn(() => {
      calls.push("delete");
      const request = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    });
    vi.stubGlobal("indexedDB", { deleteDatabase });

    const reset = runOneTimeMigrationReset();
    await Promise.resolve();
    expect(deleteDatabase).not.toHaveBeenCalled();

    finishClosing();
    await reset;

    expect(calls).toEqual(["close", "delete"]);
    expect(deleteDatabase).toHaveBeenCalledWith("formex-cache");
  });

  it("reports the migration as pending until the reset stamps its marker", async () => {
    const deleteDatabase = vi.fn(() => {
      const request = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    });
    vi.stubGlobal("indexedDB", { deleteDatabase });

    expect(isMigrationCurrent()).toBe(false);
    await runOneTimeMigrationReset();
    expect(deleteDatabase).toHaveBeenCalledWith("formex-cache");
    expect(isMigrationCurrent()).toBe(true);
    expect(window.localStorage.getItem("legalviz-migration-version")).toBeTruthy();
  });

  it("treats an unreadable localStorage as needing the reset", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(isMigrationCurrent()).toBe(false);
  });
});
