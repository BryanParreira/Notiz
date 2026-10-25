import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/chat/components/message/normal", () => ({
  NormalMessage: ({ message }: { message: { id: string } }) => (
    <div data-testid={`message-${message.id}`} />
  ),
}));

vi.mock("~/chat/components/message/loading", () => ({
  LoadingMessage: () => <div data-testid="loading" />,
}));

import { ChatBodyNonEmpty } from "./non-empty";

import type { NotizUIMessage } from "~/chat/types";

const user: NotizUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

describe("ChatBodyNonEmpty", () => {
  beforeEach(cleanup);

  it("says so when the model finished without an answer", () => {
    const onReload = vi.fn();
    render(
      <ChatBodyNonEmpty messages={[user]} status="ready" onReload={onReload} />,
    );

    expect(screen.getByText("No answer came back.")).toBeTruthy();
    screen.getByRole("button", { name: /try again/i }).click();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("treats a hidden stray tool call as no answer", () => {
    const assistant: NotizUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: '{"name": "search_sessions", "parameters": {"query": "hello"}}',
        },
      ],
    };
    render(<ChatBodyNonEmpty messages={[user, assistant]} status="ready" />);

    expect(screen.getByText("No answer came back.")).toBeTruthy();
  });

  it("stays quiet while a reply is on its way or has arrived", () => {
    const { rerender } = render(
      <ChatBodyNonEmpty messages={[user]} status="submitted" />,
    );
    expect(screen.queryByText("No answer came back.")).toBeNull();

    const assistant: NotizUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "Hi there!" }],
    };
    rerender(<ChatBodyNonEmpty messages={[user, assistant]} status="ready" />);
    expect(screen.queryByText("No answer came back.")).toBeNull();
  });
});
