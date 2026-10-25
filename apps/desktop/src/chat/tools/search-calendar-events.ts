import { tool } from "ai";
import { z } from "zod";

import { lenientInt } from "./lenient";
import type { ToolDependencies } from "./types";

export const buildSearchCalendarEventsTool = (deps: ToolDependencies) =>
  tool({
    description:
      "Search calendar events and return schedule, location, and linked session info.",
    inputSchema: z.object({
      query: z.string().describe("Search query for calendar events"),
      limit: lenientInt(1, 20).describe("Maximum number of events to return"),
    }),
    execute: async (params: { query: string; limit?: number }) => {
      const limit = params.limit ?? 8;
      const results = await deps.getCalendarEventSearchResults(
        params.query,
        limit,
      );

      return {
        query: params.query,
        results,
      };
    },
  });
