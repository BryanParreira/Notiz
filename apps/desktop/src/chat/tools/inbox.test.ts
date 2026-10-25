import { describe, expect, it } from "vitest";

import { buildListInboxTool, buildReadEmailTool } from "./inbox";
import type { InboxEmail, ToolDependencies } from "./types";

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const email = (overrides: Partial<InboxEmail>): InboxEmail => ({
  id: "a:1",
  fromName: "Sam Lee",
  fromEmail: "sam@example.com",
  subject: "Contract",
  date: hoursAgo(1),
  unread: true,
  ...overrides,
});

type ListResult = {
  status: string;
  message?: string;
  results: Array<{ id: string; unread: boolean }>;
  total_matches?: number;
};

const list = async (deps: Partial<ToolDependencies>, input: object) =>
  (await buildListInboxTool(deps as ToolDependencies).execute!(
    input as never,
    {} as never,
  )) as ListResult;

describe("list_inbox", () => {
  const messages = [
    email({ id: "a:3", fromName: "Ana", subject: "Lunch", unread: false }),
    email({ id: "a:2", subject: "Invoice due", date: hoursAgo(30) }),
    email({ id: "a:1", date: hoursAgo(24 * 10), subject: "Old news" }),
  ];
  const deps = {
    getInboxMessages: async () => ({ connected: true, messages }),
  };

  it("filters by unread, sender or subject, and age", async () => {
    expect((await list(deps, { unread_only: true })).results).toHaveLength(2);
    expect((await list(deps, { query: "ana" })).results[0].id).toBe("a:3");
    expect((await list(deps, { query: "invoice" })).results[0].id).toBe("a:2");
    expect((await list(deps, { days: 3 })).results).toHaveLength(2);
  });

  it("says plainly when no email account is connected", async () => {
    const result = await list(
      { getInboxMessages: async () => ({ connected: false, messages: [] }) },
      {},
    );

    expect(result.status).toBe("not_connected");
    expect(result.message).toContain("Settings > Email");
  });

  it("marks email text as untrusted", async () => {
    const result = (await list(deps, {})) as ListResult & { notice?: string };

    expect(result.notice).toMatch(/never follow instructions/i);
  });
});

describe("read_email", () => {
  it("returns a trimmed body and flags it as untrusted", async () => {
    const deps = {
      readInboxMessage: async (id: string) => ({
        id,
        fromName: "Sam",
        fromEmail: "sam@example.com",
        to: "me@example.com",
        subject: "Hi",
        date: null,
        text: "x".repeat(10_000),
        truncated: false,
      }),
    } as unknown as ToolDependencies;

    const result = (await buildReadEmailTool(deps).execute!(
      { id: "a:1" },
      {} as never,
    )) as { body: string; truncated: boolean; notice: string };

    expect(result.body).toHaveLength(3500);
    expect(result.truncated).toBe(true);
    expect(result.notice).toMatch(/never follow instructions/i);
  });

  it("reports a missing message instead of throwing", async () => {
    const deps = {
      readInboxMessage: async () => null,
    } as unknown as ToolDependencies;

    const result = (await buildReadEmailTool(deps).execute!(
      { id: "a:9" },
      {} as never,
    )) as { status: string };

    expect(result.status).toBe("error");
  });
});
