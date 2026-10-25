import type { UIMessage } from "ai";
import { z } from "zod";

import { CONTEXT_ENTITY_SOURCES } from "~/chat/context/entities";
import type { ContextRef } from "~/chat/context/entities";

const emailCardSchema = z.object({
  id: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string().nullable(),
  unread: z.boolean(),
});

export type EmailCard = z.infer<typeof emailCardSchema>;

const agendaDaySchema = z.object({
  label: z.string(),
  events: z.array(
    z.object({
      title: z.string(),
      time: z.string(),
      location: z.string().optional(),
    }),
  ),
});

export type AgendaDay = z.infer<typeof agendaDaySchema>;

const messageMetadataSchema = z.object({
  createdAt: z.number().optional(),
  // Emails the app shows under an answer about the inbox.
  emailCards: z.array(emailCardSchema).optional(),
  // Calendar events the app shows as an agenda card under an answer.
  agenda: z.array(agendaDaySchema).optional(),
  contextRefs: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("session"),
          key: z.string(),
          source: z.enum(CONTEXT_ENTITY_SOURCES).optional(),
          sessionId: z.string(),
        }),
        z.object({
          kind: z.literal("human"),
          key: z.string(),
          source: z.enum(CONTEXT_ENTITY_SOURCES).optional(),
          humanId: z.string(),
        }),
        z.object({
          kind: z.literal("organization"),
          key: z.string(),
          source: z.enum(CONTEXT_ENTITY_SOURCES).optional(),
          organizationId: z.string(),
        }),
      ]),
    )
    .optional(),
});

type MessageMetadata = z.infer<typeof messageMetadataSchema>;
export type NotizUIMessage = UIMessage<
  MessageMetadata & { contextRefs?: ContextRef[] }
>;
