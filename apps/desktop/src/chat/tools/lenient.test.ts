import { describe, expect, it } from "vitest";

import { buildListInboxTool } from "./inbox";
import type { ToolDependencies } from "./types";

describe("lenient tool arguments", () => {
  it("accepts numbers and booleans sent as text, as small models do", () => {
    const schema = buildListInboxTool({} as ToolDependencies).inputSchema as {
      safeParse: (value: unknown) => {
        success: boolean;
        data?: Record<string, unknown>;
      };
    };

    const parsed = schema.safeParse({ limit: "10", unread_only: "true" });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ limit: 10, unread_only: true });
  });

  it("still rejects values that are clearly wrong", () => {
    const schema = buildListInboxTool({} as ToolDependencies).inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };

    expect(schema.safeParse({ limit: "lots" }).success).toBe(false);
    expect(schema.safeParse({ limit: 500 }).success).toBe(false);
  });
});
