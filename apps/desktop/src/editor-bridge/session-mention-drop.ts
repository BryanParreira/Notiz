import type { SessionMentionDropConfig } from "@notiz/editor/note";

import {
  hasSessionContextDragData,
  readSessionMentionDragData,
} from "./session-drag";

export const sessionMentionDropConfig = {
  has: hasSessionContextDragData,
  read: readSessionMentionDragData,
} satisfies SessionMentionDropConfig;
