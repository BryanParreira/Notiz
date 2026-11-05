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

  it("keeps styles from the document head so newsletters keep their layout", () => {
    const html =
      '<html><head><style>.hero{width:100%;background:#eee}</style></head><body><div class="hero">Hello</div></body></html>';

    expect(sanitizeEmailHtml(html)).toContain(".hero{width:100%");
  });

  it("does not turn the document title into visible text", () => {
    const html =
      '<html><head><title>Customize fraud protection</title><style>.p{display:none}</style></head><body><div class="p">preheader</div><p>Body</p></body></html>';
    const clean = sanitizeEmailHtml(html);

    expect(clean).not.toContain("Customize fraud protection");
    expect(clean).toContain(".p{display:none}");
    expect(clean).toContain("<p>Body</p>");
  });
});

describe("link handling", () => {
  it("only web, mail and phone links open outside the app", async () => {
    const { isOpenableHref } = await import("./email-frame");
    expect(isOpenableHref("https://example.com/a")).toBe(true);
    expect(isOpenableHref(" http://example.com")).toBe(true);
    expect(isOpenableHref("mailto:sam@example.com")).toBe(true);
    expect(isOpenableHref("tel:+15551234")).toBe(true);
    expect(isOpenableHref("javascript:alert(1)")).toBe(false);
    expect(isOpenableHref("file:///etc/passwd")).toBe(false);
    expect(isOpenableHref("#section")).toBe(false);
  });

  it("finds the link from a click on an element inside it", async () => {
    const { resolveLinkHref } = await import("./email-frame");
    document.body.innerHTML =
      '<a href="https://example.com/x"><span><b id="inner">Read more</b></span></a><p id="plain">hi</p>';

    expect(resolveLinkHref(document.getElementById("inner"))).toBe(
      "https://example.com/x",
    );
    expect(resolveLinkHref(document.getElementById("plain"))).toBeNull();
  });

  it("finds the link from a click on its text node", async () => {
    const { resolveLinkHref } = await import("./email-frame");
    document.body.innerHTML = '<a href="https://example.com/t">Text link</a>';
    const text = document.querySelector("a")!.firstChild;

    expect(resolveLinkHref(text)).toBe("https://example.com/t");
  });
});
