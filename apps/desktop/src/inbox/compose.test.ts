import { describe, expect, it } from "vitest";

import { composeUrl, quoteForReply, replySubject } from "./compose";

describe("composeUrl", () => {
  it("opens Gmail compose for Gmail accounts, signed in as that account", () => {
    const url = composeUrl(
      { host: "imap.gmail.com", username: "sam@gmail.com" },
      { to: "pat@example.com", subject: "Re: Hi", body: "Thanks" },
    );

    expect(url.startsWith("https://mail.google.com/mail/?")).toBe(true);
    expect(url).toContain("to=pat%40example.com");
    expect(url).toContain("su=Re%3A%20Hi");
    expect(url).toContain("authuser=sam%40gmail.com");
  });

  it("opens Outlook on the web for Microsoft accounts", () => {
    expect(
      composeUrl(
        { host: "outlook.office365.com", username: "a@b.com" },
        { to: "x@y.com" },
      ),
    ).toContain("outlook.office.com/mail/deeplink/compose?to=x%40y.com");
  });

  it("falls back to the default mail app for other accounts", () => {
    expect(
      composeUrl(
        { host: "imap.fastmail.com", username: "a@b.com" },
        { to: "x@y.com", subject: "Hi" },
      ),
    ).toBe("mailto:x%40y.com?subject=Hi&body=");
    expect(
      composeUrl({ host: "apple-mail", username: "" }, { subject: "Hi" }),
    ).toMatch(/^mailto:/);
  });

  it("works with no account at all", () => {
    expect(composeUrl(undefined, {})).toBe("mailto:?subject=&body=");
  });
});

describe("reply helpers", () => {
  it("adds Re: once", () => {
    expect(replySubject("Invoice")).toBe("Re: Invoice");
    expect(replySubject("re: Invoice")).toBe("re: Invoice");
  });

  it("quotes the original message", () => {
    const quoted = quoteForReply("Sam <sam@x.com>", null, "line one\nline two");
    expect(quoted).toContain("Sam <sam@x.com> wrote:");
    expect(quoted).toContain("> line one\n> line two");
  });
});
