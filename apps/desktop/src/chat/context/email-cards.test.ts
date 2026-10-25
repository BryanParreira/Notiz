import { describe, expect, it } from "vitest";

import type { InboxEmail } from "../tools/types";
import { pickEmailCards } from "./email-cards";

const email = (
  id: string,
  overrides: Partial<InboxEmail> = {},
): InboxEmail => ({
  id,
  fromName: "Someone",
  fromEmail: "someone@example.com",
  subject: `Subject ${id}`,
  date: null,
  unread: true,
  ...overrides,
});

describe("pickEmailCards", () => {
  const messages = [
    email("a:1", { fromName: "Stripe", fromEmail: "updates@e.stripe.com" }),
    email("a:2", { fromName: "Ana", unread: false }),
    email("a:3", {
      fromName: "Hostinger",
      fromEmail: "no-reply@hostinger.com",
    }),
  ];

  it("shows the newest emails by default, up to the limit", () => {
    expect(
      pickEmailCards(messages, "what about my email?").map((c) => c.id),
    ).toEqual(["a:1", "a:2", "a:3"]);
    expect(pickEmailCards(messages, "email", 2)).toHaveLength(2);
  });

  it("shows only unread mail when asked for unread", () => {
    expect(pickEmailCards(messages, "what's unread?").map((c) => c.id)).toEqual(
      ["a:1", "a:3"],
    );
  });

  it("shows mail from a sender the user named", () => {
    expect(
      pickEmailCards(messages, "anything from stripe?").map((c) => c.id),
    ).toEqual(["a:1"]);
  });

  it("falls back to a readable sender and subject", () => {
    const [card] = pickEmailCards(
      [email("a:9", { fromName: "", fromEmail: "x@y.com", subject: "" })],
      "email",
    );

    expect(card.from).toBe("x@y.com");
    expect(card.subject).toBe("(no subject)");
  });
});
