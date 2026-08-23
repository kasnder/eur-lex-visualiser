import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isModalDialogOpen } from "./modalDialog.js";

describe("isModalDialogOpen", () => {
  let dialog;

  beforeEach(() => {
    dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
  });

  afterEach(() => {
    dialog?.remove();
  });

  it("returns false when no modal dialog is present", () => {
    expect(isModalDialogOpen()).toBe(false);
  });

  it("returns true for a visible modal dialog", () => {
    document.body.appendChild(dialog);
    expect(isModalDialogOpen()).toBe(true);
  });

  it("ignores a non-modal dialog", () => {
    dialog.removeAttribute("aria-modal");
    document.body.appendChild(dialog);
    expect(isModalDialogOpen()).toBe(false);
  });

  it("ignores a modal dialog hidden for the current breakpoint", () => {
    dialog.style.display = "none";
    document.body.appendChild(dialog);
    expect(isModalDialogOpen()).toBe(false);
  });
});