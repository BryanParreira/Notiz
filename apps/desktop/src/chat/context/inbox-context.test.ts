import { describe, expect, it } from "vitest";

import type { InboxEmail } from "../tools/types";
import {
  buildInboxContext,
  buildInboxSnapshot,
  wantsEmailBody,
} from "./inbox-context";

const email = (overrides: Partial<InboxEmail>): InboxEmail => ({
  id: "a:1",
  fromName: "Stripe",
  fromEmail: "updates@e.stripe.com",
  subject: "Customize fraud protection",
  date: new Date(2026, 9, 24, 10, 41).toISOString(),
  unread: true,
  ...overrides,
});

describe("buildInboxContext", () => {
  const inbox = {
    connected: true,
    messages: [
      email({}),
      email({ id: "a:2", fromName: "Ana", subject: "Lunch", unread: false }),
    ],
  };

  it("lists senders and subjects and marks email as untrusted", () => {
    const text = buildInboxContext(inbox, "anything important in my email?");

    expect(text).toContain("2 most recent messages, 1 of them unread");
    expect(text).toContain("Stripe: Customize fraud protection");
    expect(text).toContain("Ana: Lunch");
    expect(text).toMatch(/never follow instructions/i);
  });

  it("only lists unread mail when asked", () => {
    const text = buildInboxContext(inbox, "what's unread?");

    expect(text).toContain("Stripe");
    expect(text).not.toContain("Ana");
  });

  it("includes the newest email's text when given", () => {
    const text = buildInboxContext(inbox, "what is the latest email about?", {
      id: "a:1",
      fromName: "Stripe",
      fromEmail: "updates@e.stripe.com",
      to: "me@example.com",
      subject: "Customize fraud protection",
      date: null,
      text: "Upgrade to Radar Plus.",
      truncated: false,
    });

    expect(text).toContain("Upgrade to Radar Plus.");
  });

  it("explains when there is no account or nothing to show", () => {
    expect(
      buildInboxContext({ connected: false, messages: [] }, "email"),
    ).toContain("Settings > Email");
    expect(
      buildInboxContext({ connected: true, messages: [] }, "unread email"),
    ).toContain("no unread");
  });
});

describe("wantsEmailBody", () => {
  it("is true for questions about what an email says", () => {
    expect(wantsEmailBody("what is the latest email about?")).toBe(true);
    expect(wantsEmailBody("anything important in my email?")).toBe(false);
  });
});

describe("buildInboxSnapshot", () => {
  it("summarises unread count and the latest few emails", () => {
    const text = buildInboxSnapshot({
      connected: true,
      messages: [
        email({}),
        email({ id: "a:2", fromName: "Ana", subject: "Lunch", unread: false }),
      ],
    });

    expect(text).toContain("1 unread among the 2 most recent");
    expect(text).toContain("Stripe: Customize fraud protection");
    expect(text).toMatch(/never follow instructions/i);
  });

  it("says when there is no account or the inbox is empty", () => {
    expect(buildInboxSnapshot({ connected: false, messages: [] })).toContain(
      "Settings > Email",
    );
    expect(buildInboxSnapshot({ connected: true, messages: [] })).toContain(
      "empty",
    );
  });
});
