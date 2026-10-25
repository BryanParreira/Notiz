import {
  type ChatTransport,
  convertToModelMessages,
  type LanguageModel,
  smoothStream,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
} from "ai";

import {
  type SessionContext,
  commands as templateCommands,
} from "@notiz/plugin-template";

import type { ContextRef } from "../context/entities";
import { extractContextRefsFromMessages } from "../context/refs";
import { CONTEXT_TEXT_FIELD } from "../tools/context-text";
import type { NotizUIMessage } from "../types";
import { buildToolGuidance } from "./guidance";
import {
  getSessionIdsFromSearchOutput,
  hasContextText,
  isRecord,
  type ToolGroup,
  toolGroupsForMessage,
  toolGroupsUsedIn,
  toolNamesForGroups,
  isToolOutputPart,
  MAX_TOOL_STEPS,
  MESSAGE_WINDOW_SIZE,
  MESSAGE_WINDOW_THRESHOLD,
  type ToolOutputPart,
} from "./helpers";

type StepLike = {
  content?: Array<{
    type: string;
    toolName?: string;
    input?: unknown;
  }>;
};

export function shouldForceAnswer(
  steps: readonly StepLike[],
  stepNumber: number,
): boolean {
  if (stepNumber >= MAX_TOOL_STEPS - 1) {
    return true;
  }

  const seen = new Set<string>();
  for (const step of steps) {
    for (const part of step.content ?? []) {
      if (part.type === "tool-error") {
        return true;
      }
      if (part.type === "tool-call") {
        const key = `${part.toolName}:${JSON.stringify(part.input ?? null)}`;
        if (seen.has(key)) {
          return true;
        }
        seen.add(key);
      }
    }
  }

  return false;
}

export type ResolvedChatContext =
  | { kind: "session"; context: SessionContext }
  | { kind: "text"; text: string };

export class CustomChatTransport implements ChatTransport<NotizUIMessage> {
  constructor(
    private model: LanguageModel,
    private tools: ToolSet,
    private systemPrompt?: string,
    private resolveContextRef?: (
      ref: ContextRef,
    ) => Promise<ResolvedChatContext | null>,
    private getDataContext?: (
      groups: ToolGroup[],
      userText: string,
    ) => Promise<string | null>,
  ) {}

  // Data the app fetched for this question (calendar, email). It is slow and
  // can fail, so a problem here never stops the assistant from answering.
  private async buildData(
    groups: ToolGroup[],
    userText: string,
  ): Promise<string | null> {
    if (!this.getDataContext || groups.length === 0) return null;

    try {
      return await this.getDataContext(groups, userText);
    } catch (error) {
      console.error("[chat] failed to build data context", error);
      return null;
    }
  }

  private buildInstructions(
    groups: ToolGroup[],
    data: string | null,
  ): string | undefined {
    const parts = [this.systemPrompt, buildToolGuidance(groups), data].filter(
      (part): part is string => !!part && part.trim().length > 0,
    );
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  private async renderContextBlock(
    contextRefs: ContextRef[],
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    try {
      return await this.buildContextBlock(contextRefs, cache);
    } catch (error) {
      console.error("[chat] failed to load context", error);
      return null;
    }
  }

  private async buildContextBlock(
    contextRefs: ContextRef[],
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (!this.resolveContextRef || contextRefs.length === 0) {
      return null;
    }

    const cacheKey = JSON.stringify(contextRefs);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const seen = new Set<string>();
    const sessionContexts: SessionContext[] = [];
    const textContexts: string[] = [];
    for (const ref of contextRefs) {
      if (seen.has(ref.key)) continue;
      seen.add(ref.key);
      const context = await this.resolveContextRef(ref);
      if (!context) {
        continue;
      }

      if (context.kind === "session") {
        sessionContexts.push(context.context);
      } else if (context.text.trim()) {
        textContexts.push(context.text.trim());
      }
    }

    if (sessionContexts.length === 0 && textContexts.length === 0) {
      cache.set(cacheKey, null);
      return null;
    }

    const blocks: string[] = [];

    if (sessionContexts.length > 0) {
      // Rendered by Rust-side template engine via Tauri plugin
      const rendered = await templateCommands.render({
        contextBlock: { contexts: sessionContexts },
      });
      if (rendered.status === "ok" && rendered.data.trim()) {
        blocks.push(rendered.data.trim());
      }
    }

    if (textContexts.length > 0) {
      blocks.push(textContexts.join("\n\n"));
    }

    const result = blocks.length > 0 ? blocks.join("\n\n") : null;
    cache.set(cacheKey, result);
    return result;
  }

  private async hydrateSearchOutput(
    output: unknown,
    cache: Map<string, string | null>,
  ): Promise<unknown> {
    const sessionIds = getSessionIdsFromSearchOutput(output);
    if (sessionIds.length === 0) return output;

    const refs: ContextRef[] = sessionIds.map((sessionId) => ({
      kind: "session" as const,
      key: `session:search:${sessionId}`,
      source: "tool" as const,
      sessionId,
    }));

    const contextText = await this.renderContextBlock(refs, cache);
    if (!contextText) return output;

    return {
      ...(isRecord(output) ? output : {}),
      [CONTEXT_TEXT_FIELD]: contextText,
    };
  }

  private async expandSearchSessionsOutput(
    part: ToolOutputPart,
    cache: Map<string, string | null>,
  ): Promise<ToolOutputPart> {
    if (hasContextText(part.output)) {
      return part;
    }

    const output = await this.hydrateSearchOutput(part.output, cache);
    if (output === part.output) return part;

    return {
      ...part,
      output,
    };
  }

  private buildHydratingToolSet(cache: Map<string, string | null>): ToolSet {
    const searchTool = this.tools.search_sessions;
    if (!searchTool || typeof searchTool !== "object") {
      return this.tools;
    }

    const execute = (
      searchTool as {
        execute?: (...args: unknown[]) => Promise<unknown>;
      }
    ).execute;
    if (typeof execute !== "function") {
      return this.tools;
    }

    return {
      ...this.tools,
      search_sessions: {
        ...searchTool,
        execute: async (...args: unknown[]) => {
          const output = await execute(...args);
          if (hasContextText(output)) {
            return output;
          }
          return this.hydrateSearchOutput(output, cache);
        },
      },
    };
  }

  sendMessages: ChatTransport<NotizUIMessage>["sendMessages"] = async (
    options,
  ) => {
    const cache = new Map<string, string | null>();
    const tools = this.buildHydratingToolSet(cache);

    const effectiveContextRefs = extractContextRefsFromMessages(
      options.messages,
    );
    const effectiveContextBlock = await this.renderContextBlock(
      effectiveContextRefs,
      cache,
    );

    let lastUserMessageIndex = -1;
    for (let i = options.messages.length - 1; i >= 0; i -= 1) {
      if (options.messages[i]?.role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }

    const lastUserText =
      options.messages[lastUserMessageIndex]?.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join(" ") ?? "";
    const groups = [
      ...new Set([
        ...toolGroupsForMessage(lastUserText),
        ...toolGroupsUsedIn(options.messages),
      ]),
    ];
    const activeTools = toolNamesForGroups(groups).filter(
      (name) => name in tools,
    );

    const data = await this.buildData(groups, lastUserText);

    const agent = new ToolLoopAgent({
      model: this.model,
      instructions: this.buildInstructions(groups, data),
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      // A model that starts rambling would otherwise fill its whole memory.
      maxOutputTokens: 1200,
      prepareStep: async ({ messages, stepNumber, steps }) => {
        const windowed =
          messages.length > MESSAGE_WINDOW_THRESHOLD
            ? { messages: messages.slice(-MESSAGE_WINDOW_SIZE) }
            : {};

        // Small local models can get stuck calling a failing tool again and
        // again and never answer. Stop offering tools once a step has failed,
        // a call has repeated, or only the last step is left, so the model has
        // to write its reply.
        if (activeTools.length === 0 || shouldForceAnswer(steps, stepNumber)) {
          // toolChoice alone is not enough: with tools still in the request
          // this model replies with the raw call as text, so take them out.
          return {
            ...windowed,
            toolChoice: "none" as const,
            activeTools: [] as never[],
          };
        }
        return { ...windowed, activeTools: activeTools as never[] };
      },
    });

    const messagesWithContext: NotizUIMessage[] = [];

    for (const [index, msg] of options.messages.entries()) {
      if (msg.role === "user") {
        if (
          !effectiveContextBlock ||
          lastUserMessageIndex === -1 ||
          index !== lastUserMessageIndex
        ) {
          messagesWithContext.push(msg);
          continue;
        }

        messagesWithContext.push({
          ...msg,
          parts: [
            { type: "text" as const, text: `${effectiveContextBlock}\n\n` },
            ...msg.parts,
          ],
        });
      } else if (msg.role === "assistant") {
        const expandedParts = await Promise.all(
          msg.parts.map((part) => {
            if (
              isToolOutputPart(part) &&
              part.type === "tool-search_sessions"
            ) {
              return this.expandSearchSessionsOutput(part, cache);
            }
            return part;
          }),
        );
        messagesWithContext.push({
          ...msg,
          parts: expandedParts as NotizUIMessage["parts"],
        });
      } else {
        messagesWithContext.push(msg);
      }
    }

    const result = await agent.stream({
      messages: await convertToModelMessages(messagesWithContext),
      abortSignal: options.abortSignal,
      experimental_transform: smoothStream({
        chunking: "word",
        delayInMs: null,
      }),
    });

    return result.toUIMessageStream({
      originalMessages: options.messages,
      messageMetadata: ({ part }: { part: { type: string } }) => {
        if (part.type === "start") {
          return { createdAt: Date.now() };
        }
      },
      onError: (error: unknown) => {
        console.error(error);
        if (error instanceof Error) {
          return `${error.name}: ${error.message}`;
        }
        if (isRecord(error) && typeof error.message === "string") {
          return error.message;
        }
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      },
    });
  };

  reconnectToStream: ChatTransport<NotizUIMessage>["reconnectToStream"] =
    async () => {
      return null;
    };
}
