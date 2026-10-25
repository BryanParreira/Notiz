import { tool } from "ai";
import { z } from "zod";

import { lenientInt } from "./lenient";
import type { ToolDependencies } from "./types";

export const buildSearchContactsTool = (deps: ToolDependencies) =>
  tool({
    description:
      "Search contacts and return names, emails, phone numbers, roles, and organizations.",
    inputSchema: z.object({
      query: z.string().describe("Search query for contacts"),
      limit: lenientInt(1, 20).describe("Maximum number of contacts to return"),
    }),
    execute: async (params: { query: string; limit?: number }) => {
      const limit = params.limit ?? 8;
      const results = await deps.getContactSearchResults(params.query, limit);

      return {
        query: params.query,
        results,
      };
    },
  });
