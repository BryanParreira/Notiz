import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openNew } = vi.hoisted(() => ({ openNew: vi.fn() }));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openNew: typeof openNew }) => unknown) =>
    selector({ openNew }),
}));

import { EmailCards } from "./email-cards";

import { takePendingInboxSelection } from "~/inbox/pending-selection";

const cards = [
  {
    id: "acc-1:42",
    from: "Stripe",
    subject: "Fraud protection",
    date: null,
    unread: true,
  },
  { id: "acc-1:41", from: "Ana", subject: "Lunch", date: null, unread: false },
];

describe("EmailCards", () => {
  beforeEach(() => {
    cleanup();
    openNew.mockClear();
    takePendingInboxSelection();
  });

  it("lists each email with sender and subject", () => {
    render(<EmailCards cards={cards} />);

    expect(screen.getByText("Stripe")).toBeTruthy();
    expect(screen.getByText("Fraud protection")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("opens the Inbox on the clicked email", () => {
    render(<EmailCards cards={cards} />);

    fireEvent.click(screen.getByText("Fraud protection"));

    expect(openNew).toHaveBeenCalledWith({ type: "inbox" });
    expect(takePendingInboxSelection()).toBe("acc-1-42");
  });

  it("opens the Inbox without picking an email from the footer", () => {
    render(<EmailCards cards={cards} />);

    fireEvent.click(screen.getByText("Open Inbox"));

    expect(openNew).toHaveBeenCalledWith({ type: "inbox" });
    expect(takePendingInboxSelection()).toBeNull();
  });
});
