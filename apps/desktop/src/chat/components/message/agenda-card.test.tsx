import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openNew } = vi.hoisted(() => ({ openNew: vi.fn() }));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openNew: typeof openNew }) => unknown) =>
    selector({ openNew }),
}));

import { AgendaCard } from "./agenda-card";

const days = [
  {
    label: "Monday, Oct 26",
    events: [
      { title: "CIS 121", time: "8:00 AM-9:50 AM" },
      { title: "Gym", time: "5:00 PM", location: "Rec centre" },
    ],
  },
  {
    label: "Tuesday, Oct 27",
    events: [{ title: "MATH 115", time: "2:00 PM" }],
  },
];

describe("AgendaCard", () => {
  beforeEach(() => {
    cleanup();
    openNew.mockClear();
  });

  it("shows each day with its events, times and places", () => {
    render(<AgendaCard days={days} />);

    expect(screen.getByText("Monday, Oct 26")).toBeTruthy();
    expect(screen.getByText("CIS 121")).toBeTruthy();
    expect(screen.getByText("8:00 AM-9:50 AM")).toBeTruthy();
    expect(screen.getByText(/Rec centre/)).toBeTruthy();
    expect(screen.getByText("Tuesday, Oct 27")).toBeTruthy();
  });

  it("opens the Calendar from the footer", () => {
    render(<AgendaCard days={days} />);

    fireEvent.click(screen.getByText("Open Calendar"));

    expect(openNew).toHaveBeenCalledWith({ type: "calendar" });
  });
});
