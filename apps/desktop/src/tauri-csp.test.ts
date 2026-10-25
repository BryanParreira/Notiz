import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf8"),
);

describe("tauri security config", () => {
  // index.html has an inline <style>, so Tauri would add a nonce to style-src,
  // and a nonce makes browsers ignore 'unsafe-inline'. That strips every style
  // from the sandboxed email frame, which inherits the app's policy.
  it("keeps style-src free of injected nonces so email styles apply", () => {
    expect(config.app.security.dangerousDisableAssetCspModification).toContain(
      "style-src",
    );
    expect(config.app.security.csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });
});
