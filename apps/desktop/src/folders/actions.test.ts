import { describe, expect, it } from "vitest";

import { joinFolderPath, normalizeFolderName } from "./actions";

describe("folder names", () => {
  it("trims and accepts plain names", () => {
    expect(normalizeFolderName("  Clients  ")).toBe("Clients");
  });

  it("rejects empty names, dot paths and separators", () => {
    for (const bad of ["", "   ", ".", "..", "a/b", "a\\b"]) {
      expect(normalizeFolderName(bad)).toBeNull();
    }
  });

  it("joins nested paths", () => {
    expect(joinFolderPath(null, "Work")).toBe("Work");
    expect(joinFolderPath("Work", "Acme")).toBe("Work/Acme");
  });
});
