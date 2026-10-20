import { describe, expect, it } from "vitest";

import { buildEmailDocument, sanitizeEmailHtml } from "./email-frame";

describe("email html", () => {
  it("removes scripts, handlers, frames and forms but keeps content", () => {
    const clean = sanitizeEmailHtml(
      `<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://e.com"></iframe><form action="/x"><input name="a"></form><img src="https://cdn.example.com/a.png" onerror="y()">`,
    );

    expect(clean).toContain("<p>Hi</p>");
    expect(clean).toContain('src="https://cdn.example.com/a.png"');
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<form");
  });

  it("lets the frame load images only when switched on", () => {
    const on = buildEmailDocument("<p>x</p>", true);
    const off = buildEmailDocument("<p>x</p>", false);

    expect(on).toContain("img-src data: https:");
    expect(off).toContain("img-src data:;");
    expect(off).not.toContain("img-src data: https:");
    expect(on).toContain("default-src 'none'");
  });
});
