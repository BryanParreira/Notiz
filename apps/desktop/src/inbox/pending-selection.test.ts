import { describe, expect, it } from "vitest";

import {
  selectInboxMessageOnOpen,
  takePendingInboxSelection,
} from "./pending-selection";

describe("pending inbox selection", () => {
  it("turns a chat id into the Inbox row key, once", () => {
    selectInboxMessageOnOpen("account-uuid-1:77");

    expect(takePendingInboxSelection()).toBe("account-uuid-1-77");
    expect(takePendingInboxSelection()).toBeNull();
  });

  it("ignores ids it cannot read", () => {
    selectInboxMessageOnOpen("nonsense");

    expect(takePendingInboxSelection()).toBeNull();
  });
});
