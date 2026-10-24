import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatRegenerate: vi.fn(),
  chatSendMessage: vi.fn(),
  chatSetMessages: vi.fn(),
  chatStop: vi.fn(),
  chatInits: [] as unknown[],
  chatMessagesTable: {} as Record<string, unknown>,
  messages: [] as unknown[],
  status: "ready",
  store: null as unknown,
  transport: {} as unknown,
}));

vi.mock("@ai-sdk/react", () => ({
  Chat: class MockChat {
    id: string;

    constructor(init: { id: string }) {
      this.id = init.id;
      mocks.chatInits.push(init);
    }
  },
  useChat: () => ({
    messages: mocks.messages,
    sendMessage: mocks.chatSendMessage,
    regenerate: mocks.chatRegenerate,
    stop: mocks.chatStop,
    status: mocks.status,
    error: undefined,
    setMessages: mocks.chatSetMessages,
  }),
}));

vi.mock("~/chat/context/use-chat-context-pipeline", () => ({
  useChatContextPipeline: () => ({
    contextEntities: [],
    pendingRefs: [],
  }),
}));

vi.mock("~/chat/transport/use-transport", () => ({
  useTransport: () => ({
    transport: mocks.transport,
    isSystemPromptReady: true,
  }),
}));

vi.mock("~/store/tinybase/store/main", () => ({
  STORE_ID: "main",
  UI: {
    useStore: () => mocks.store,
    useTable: () => mocks.chatMessagesTable,
    useValues: () => ({ user_id: "user-1" }),
  },
}));

import { ChatSession, type ChatSessionRenderProps } from "./session-provider";

import { buildPersistedChatMessageRow } from "~/chat/store/persisted-messages";
import type { NotizUIMessage } from "~/chat/types";

type FakeStore = ReturnType<typeof createStore>;

function createStore(rows: Record<string, Record<string, unknown>>) {
  const table = new Map(Object.entries(rows));

  return {
    delRow: vi.fn((tableName: string, rowId: string) => {
      if (tableName === "chat_messages") {
        table.delete(rowId);
      }
    }),
    forEachRow: vi.fn(
      (
        tableName: string,
        callback: (rowId: string, forEachCell: () => void) => void,
      ) => {
        if (tableName !== "chat_messages") {
          return;
        }
        table.forEach((_row, rowId) => callback(rowId, () => {}));
      },
    ),
    getRow: vi.fn((tableName: string, rowId: string) => {
      if (tableName !== "chat_messages") {
        return undefined;
      }
      return table.get(rowId);
    }),
    setRow: vi.fn(
      (tableName: string, rowId: string, row: Record<string, unknown>) => {
        if (tableName === "chat_messages") {
          table.set(rowId, row);
        }
      },
    ),
    transaction: vi.fn((callback: () => void) => callback()),
  };
}

function persistedAssistantRow(message: NotizUIMessage) {
  return buildPersistedChatMessageRow({
    message,
    chatGroupId: "group-1",
    userId: "user-1",
    status: "ready",
  }) as unknown as Record<string, unknown>;
}

function renderSession() {
  render(
    <ChatSession chatGroupId="group-1" sessionId="session-1">
      {({ regenerate }) => (
        <button type="button" onClick={regenerate}>
          Regenerate
        </button>
      )}
    </ChatSession>,
  );
}

describe("ChatSession", () => {
  beforeEach(() => {
    cleanup();
    mocks.chatRegenerate.mockClear();
    mocks.chatSendMessage.mockClear();
    mocks.chatSetMessages.mockClear();
    mocks.chatStop.mockClear();
    mocks.chatInits = [];
    mocks.chatMessagesTable = {};
    mocks.messages = [];
    mocks.status = "ready";
    mocks.store = createStore({});
    mocks.transport = {};
  });

  it("does not delete the previous persisted assistant when retrying an unpersisted empty assistant", () => {
    const previousAssistant: NotizUIMessage = {
      id: "assistant-previous",
      role: "assistant",
      parts: [{ type: "text", text: "Previous answer" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
    };
    const store = createStore({
      "assistant-previous": persistedAssistantRow(previousAssistant),
    });
    mocks.store = store;
    mocks.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "First question" }],
      },
      previousAssistant,
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Retry question" }],
      },
      {
        id: "assistant-empty",
        role: "assistant",
        parts: [],
      },
    ];

    renderSession();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(store.delRow).toHaveBeenCalledWith(
      "chat_messages",
      "assistant-empty",
    );
    expect(
      (store as FakeStore).getRow("chat_messages", "assistant-previous"),
    ).toBeDefined();
    expect(mocks.chatRegenerate).toHaveBeenCalledTimes(1);
  });

  it("deletes the persisted row for the in-memory assistant being regenerated", () => {
    const assistant: NotizUIMessage = {
      id: "assistant-current",
      role: "assistant",
      parts: [{ type: "text", text: "Current answer" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
    };
    const store = createStore({
      "assistant-current": persistedAssistantRow(assistant),
    });
    mocks.store = store;
    mocks.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Question" }],
      },
      assistant,
    ];

    renderSession();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(store.delRow).toHaveBeenCalledWith(
      "chat_messages",
      "assistant-current",
    );
    expect(store.getRow("chat_messages", "assistant-current")).toBeUndefined();
    expect(mocks.chatRegenerate).toHaveBeenCalledTimes(1);
  });

  it("deletes the last assistant row when a trailing user message is present", () => {
    const assistant: NotizUIMessage = {
      id: "assistant-current",
      role: "assistant",
      parts: [{ type: "text", text: "Current answer" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
    };
    const store = createStore({
      "assistant-current": persistedAssistantRow(assistant),
    });
    mocks.store = store;
    mocks.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Question" }],
      },
      assistant,
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Follow-up" }],
      },
    ];

    renderSession();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(store.delRow).toHaveBeenCalledWith(
      "chat_messages",
      "assistant-current",
    );
    expect(store.getRow("chat_messages", "assistant-current")).toBeUndefined();
    expect(mocks.chatRegenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps the sdk chat and sends through the latest transport", async () => {
    const initialSend = vi.fn();
    const readySend = vi.fn().mockResolvedValue("stream");
    mocks.transport = { sendMessages: initialSend };

    const { rerender } = render(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );

    mocks.transport = { sendMessages: readySend };
    rerender(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );

    expect(mocks.chatInits).toHaveLength(1);
    const { transport } = mocks.chatInits[0] as {
      transport: { sendMessages: (options: unknown) => Promise<unknown> };
    };
    await expect(transport.sendMessages({})).resolves.toBe("stream");
    expect(initialSend).not.toHaveBeenCalled();
    expect(readySend).toHaveBeenCalledTimes(1);
  });

  it("fails sends cleanly while no transport is ready", async () => {
    mocks.transport = null;

    render(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );

    const { transport } = mocks.chatInits[0] as {
      transport: { sendMessages: (options: unknown) => Promise<unknown> };
    };
    await expect(transport.sendMessages({})).rejects.toThrow(
      "Chat model is not ready",
    );
  });

  it("syncs sdk messages when persisted chat rows load later", async () => {
    const store = createStore({});
    mocks.store = store;
    mocks.chatMessagesTable = {};
    const userMessage: NotizUIMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Question" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:00Z") },
    };

    const { rerender } = render(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );
    expect(mocks.chatInits).toHaveLength(1);

    store.setRow(
      "chat_messages",
      userMessage.id,
      buildPersistedChatMessageRow({
        message: userMessage,
        chatGroupId: "group-1",
        userId: "user-1",
        status: "ready",
      }) as unknown as Record<string, unknown>,
    );
    mocks.chatMessagesTable = { [userMessage.id]: true };
    rerender(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );

    await waitFor(() => {
      expect(mocks.chatSetMessages).toHaveBeenCalledWith([userMessage]);
    });
    expect(mocks.chatInits).toHaveLength(1);
  });

  it("keeps the sdk chat when first send creates a chat group", () => {
    const { rerender } = render(
      <ChatSession sessionId="session-1">{() => null}</ChatSession>,
    );

    rerender(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );

    expect(mocks.chatInits).toHaveLength(1);
  });

  it("does not replace streaming sdk messages with stale persisted rows", () => {
    const userMessage: NotizUIMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Question" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:00Z") },
    };
    const assistantMessage: NotizUIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Partial answer" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
    };
    const store = createStore({
      "user-1": buildPersistedChatMessageRow({
        message: userMessage,
        chatGroupId: "group-1",
        userId: "user-1",
        status: "ready",
      }) as unknown as Record<string, unknown>,
    });
    mocks.store = store;
    mocks.messages = [userMessage, assistantMessage];
    mocks.status = "streaming";

    render(
      <ChatSession chatGroupId="group-1" sessionId="session-1">
        {() => null}
      </ChatSession>,
    );

    expect(mocks.chatSetMessages).not.toHaveBeenCalled();
  });

  it("persists a first-send assistant response to the newly created group", () => {
    const store = createStore({});
    mocks.store = store;
    const captured: { send?: ChatSessionRenderProps["sendMessage"] } = {};

    render(
      <ChatSession sessionId="session-1">
        {(props) => {
          captured.send = props.sendMessage;
          return null;
        }}
      </ChatSession>,
    );

    const sendMessage = captured.send;
    expect(sendMessage).toBeDefined();
    sendMessage!(
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Question" }],
      },
      { chatGroupId: "new-group" },
    );

    const onFinish = mocks.chatInits[0] as {
      onFinish: (params: {
        message: NotizUIMessage;
        messages: NotizUIMessage[];
        isAbort: boolean;
      }) => void;
    };
    const userMessage: NotizUIMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Question" }],
    };
    onFinish.onFinish({
      isAbort: false,
      message: {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Answer" }],
        metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
      },
      messages: [
        userMessage,
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Answer" }],
          metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
        },
      ],
    });

    expect(store.setRow).toHaveBeenCalledWith(
      "chat_messages",
      "assistant-1",
      expect.objectContaining({
        chat_group_id: "new-group",
        content: "Answer",
      }),
    );
  });

  it("persists overlapping assistant responses to their submitted groups", () => {
    const store = createStore({});
    mocks.store = store;
    const captured: { send?: ChatSessionRenderProps["sendMessage"] } = {};

    render(
      <ChatSession chatGroupId="initial-group" sessionId="session-1">
        {(props) => {
          captured.send = props.sendMessage;
          return null;
        }}
      </ChatSession>,
    );

    const userOne: NotizUIMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "First question" }],
    };
    const userTwo: NotizUIMessage = {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Second question" }],
    };
    captured.send!(userOne, { chatGroupId: "group-1" });
    captured.send!(userTwo, { chatGroupId: "group-2" });

    const onFinish = mocks.chatInits[0] as {
      onFinish: (params: {
        message: NotizUIMessage;
        messages: NotizUIMessage[];
        isAbort: boolean;
      }) => void;
    };
    const assistantOne: NotizUIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "First answer" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:01Z") },
    };
    const assistantTwo: NotizUIMessage = {
      id: "assistant-2",
      role: "assistant",
      parts: [{ type: "text", text: "Second answer" }],
      metadata: { createdAt: Date.parse("2024-01-01T00:00:02Z") },
    };

    onFinish.onFinish({
      isAbort: false,
      message: assistantOne,
      messages: [userOne, assistantOne, userTwo],
    });
    onFinish.onFinish({
      isAbort: false,
      message: assistantTwo,
      messages: [userOne, assistantOne, userTwo, assistantTwo],
    });

    expect(store.setRow).toHaveBeenCalledWith(
      "chat_messages",
      "assistant-1",
      expect.objectContaining({
        chat_group_id: "group-1",
        content: "First answer",
      }),
    );
    expect(store.setRow).toHaveBeenCalledWith(
      "chat_messages",
      "assistant-2",
      expect.objectContaining({
        chat_group_id: "group-2",
        content: "Second answer",
      }),
    );
  });
});
