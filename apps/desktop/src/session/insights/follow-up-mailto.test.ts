import { describe, expect, it } from "vitest";

import { buildFollowUpMailto } from "./follow-up-mailto";

describe("buildFollowUpMailto", () => {
  it("encodes recipients, subject and body and removes duplicates", () => {
    const url = buildFollowUpMailto({
      recipients: ["a@x.com", " a@x.com ", "b@y.com", ""],
      subject: "Follow-up: Q4 plan",
      body: "Hi,\nThanks & talk soon",
    });

    expect(url).toBe(
      "mailto:a%40x.com,b%40y.com?subject=Follow-up%3A%20Q4%20plan&body=Hi%2C%0AThanks%20%26%20talk%20soon",
    );
  });

  it("keeps the URL within a length mail apps accept", () => {
    const url = buildFollowUpMailto({
      recipients: [],
      subject: "Long",
      body: "word ".repeat(2000),
    });

    expect(url.length).toBeLessThanOrEqual(1800);
    expect(decodeURIComponent(url)).toContain("…");
  });
});
