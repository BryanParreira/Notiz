import { format } from "date-fns";
import { useSyncExternalStore } from "react";

import { md2json } from "@notiz/editor/markdown";

import type * as main from "~/store/tinybase/store/main";
import { createSession } from "~/store/tinybase/store/sessions";

export type TemplateCategory =
  | "Mine"
  | "Meetings"
  | "Work"
  | "Planning"
  | "Personal"
  | "Learning";

export type NoteTemplate = {
  id: string;
  title: string;
  description: string;
  /** Soft tint used on the preview; a CSS color. */
  accent: string;
  category: TemplateCategory;
  /** Markdown. `{{date}}` and `{{day}}` are filled in when it is used. */
  body: string;
  custom?: boolean;
};

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "Mine",
  "Meetings",
  "Work",
  "Planning",
  "Personal",
  "Learning",
];

export const BUILT_IN_TEMPLATES: NoteTemplate[] = [
  {
    id: "meeting",
    title: "Meeting notes",
    description: "Agenda, discussion, decisions and who does what",
    accent: "#e8dcc4",
    category: "Meetings",
    body: `**Date:** {{date}}\n**Attendees:** \n\n---\n\n## Agenda\n\n- \n\n## Discussion\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] `,
  },
  {
    id: "one-on-one",
    title: "1:1",
    description: "Recurring check-in with one person",
    accent: "#d9e4d0",
    category: "Meetings",
    body: `**With:** \n**Date:** {{date}}\n\n---\n\n## How are things going?\n\n- \n\n## Since last time\n\n- \n\n## To discuss\n\n- \n\n## Feedback\n\n- \n\n## Follow-ups\n\n- [ ] `,
  },
  {
    id: "standup",
    title: "Daily standup",
    description: "Yesterday, today and anything blocking",
    accent: "#dde6d4",
    category: "Meetings",
    body: `**{{day}}**\n\n## Yesterday\n\n- \n\n## Today\n\n- [ ] \n\n## Blockers\n\n- `,
  },
  {
    id: "client-call",
    title: "Client call",
    description: "Needs, answers given and next steps",
    accent: "#ead9c8",
    category: "Meetings",
    body: `**Client:** \n**Date:** {{date}}\n\n---\n\n## Their goals\n\n- \n\n## What we discussed\n\n- \n\n## Questions to answer\n\n- [ ] \n\n## Next steps\n\n- [ ] `,
  },
  {
    id: "interview",
    title: "Interview",
    description: "Structured notes with a verdict",
    accent: "#d6dfe8",
    category: "Meetings",
    body: `**Candidate:** \n**Role:** \n**Date:** {{date}}\n\n---\n\n## Background\n\n- \n\n## Strengths\n\n- \n\n## Concerns\n\n- \n\n## Questions they asked\n\n- \n\n> **Verdict** — hire, hold or pass, and why.`,
  },
  {
    id: "project",
    title: "Project plan",
    description: "Goal, scope, milestones and open questions",
    accent: "#d4dff0",
    category: "Work",
    body: `> **Goal** — one sentence on what done looks like.\n\n**Owner:** \n**Target date:** \n\n---\n\n## Scope\n\n- \n\n## Milestones\n\n- [ ] \n- [ ] \n- [ ] \n\n## Risks\n\n- \n\n## Open questions\n\n- `,
  },
  {
    id: "spec",
    title: "Product spec",
    description: "Problem, proposal and how we will know it worked",
    accent: "#dcd8ee",
    category: "Work",
    body: `## Problem\n\nWho has it and why it matters.\n\n## Proposal\n\n\n\n## Requirements\n\n- [ ] \n\n## Out of scope\n\n- \n\n## Success looks like\n\n- \n\n## Open questions\n\n- `,
  },
  {
    id: "decision",
    title: "Decision log",
    description: "Context, options and the call you made",
    accent: "#ecd5d0",
    category: "Work",
    body: `> **Decision** — state it in one line.\n\n**Date:** {{date}}\n\n---\n\n## Context\n\n\n\n## Options considered\n\n- **Option A** — \n- **Option B** — \n\n## Why this one\n\n\n\n## Revisit on\n\n- `,
  },
  {
    id: "retro",
    title: "Retrospective",
    description: "What went well, what did not, what to change",
    accent: "#e2d6e8",
    category: "Work",
    body: `**Period:** \n\n---\n\n## What went well\n\n- \n\n## What did not\n\n- \n\n## What we will change\n\n- [ ] `,
  },
  {
    id: "brainstorm",
    title: "Brainstorm",
    description: "Dump ideas first, judge them later",
    accent: "#f0e6b8",
    category: "Planning",
    body: `> **Question** — what are we trying to solve?\n\n## Ideas\n\n- \n- \n- \n\n## Best bets\n\n- \n\n## Next step\n\n- [ ] `,
  },
  {
    id: "weekly-plan",
    title: "Weekly plan",
    description: "Top priorities and a day-by-day outline",
    accent: "#d8e4ec",
    category: "Planning",
    body: `**Week of {{date}}**\n\n## Top three\n\n- [ ] \n- [ ] \n- [ ] \n\n## Monday\n\n- \n\n## Tuesday\n\n- \n\n## Wednesday\n\n- \n\n## Thursday\n\n- \n\n## Friday\n\n- `,
  },
  {
    id: "weekly-review",
    title: "Weekly review",
    description: "Reflect on the week and set up the next one",
    accent: "#dcd4ec",
    category: "Planning",
    body: `**Week ending {{date}}**\n\n---\n\n## Wins\n\n- \n\n## What did not go well\n\n- \n\n## What I learned\n\n- \n\n## Next week\n\n- [ ] `,
  },
  {
    id: "goals",
    title: "Goals and OKRs",
    description: "Objectives with measurable key results",
    accent: "#e6dcc6",
    category: "Planning",
    body: `## Objective\n\nWhat do I want to achieve?\n\n## Key results\n\n- [ ] \n- [ ] \n- [ ] \n\n## Why it matters\n\n\n\n## Check-ins\n\n- `,
  },
  {
    id: "trip",
    title: "Trip planner",
    description: "Dates, places, bookings and a packing list",
    accent: "#cfe4e6",
    category: "Planning",
    body: `> **Where and when** — \n\n## Itinerary\n\n- \n\n## Bookings\n\n- [ ] Flights\n- [ ] Stay\n- [ ] Transport\n\n## Packing\n\n- [ ] Passport\n- [ ] Charger\n- [ ] `,
  },
  {
    id: "journal",
    title: "Journal",
    description: "A calm entry with a few prompts",
    accent: "#e6d6dd",
    category: "Personal",
    body: `**{{day}}**\n\n## How I feel\n\n\n\n## What happened\n\n\n\n## Grateful for\n\n- `,
  },
  {
    id: "morning",
    title: "Morning pages",
    description: "Three intentions to start the day",
    accent: "#f2e0c0",
    category: "Personal",
    body: `**{{day}}**\n\n## Today I will\n\n- [ ] \n- [ ] \n- [ ] \n\n## Grateful for\n\n- \n\n## On my mind\n\n`,
  },
  {
    id: "habits",
    title: "Habit tracker",
    description: "Check habits off through the week",
    accent: "#f0d4c4",
    category: "Personal",
    body: `**Week of {{date}}**\n\n## Habits\n\n- [ ] Exercise\n- [ ] Read\n- [ ] Write\n- [ ] Sleep before midnight\n\n## Notes\n\n- `,
  },
  {
    id: "checklist",
    title: "Checklist",
    description: "A plain list of things to do",
    accent: "#d4e4da",
    category: "Personal",
    body: `- [ ] \n- [ ] \n- [ ] `,
  },
  {
    id: "recipe",
    title: "Recipe",
    description: "Ingredients, steps and how it turned out",
    accent: "#f0dccc",
    category: "Personal",
    body: `**Serves:** \n**Time:** \n\n---\n\n## Ingredients\n\n- \n\n## Steps\n\n1. \n\n## Notes\n\n- `,
  },
  {
    id: "book",
    title: "Book notes",
    description: "Key ideas, quotes and what to apply",
    accent: "#d8e0cc",
    category: "Learning",
    body: `**Author:** \n**Started:** {{date}}\n\n---\n\n## Key ideas\n\n- \n\n## Quotes\n\n> \n\n## What I will apply\n\n- [ ] `,
  },
  {
    id: "lecture",
    title: "Lecture notes",
    description: "Topic, key points and questions to follow up",
    accent: "#d6e0e8",
    category: "Learning",
    body: `**Course:** \n**Date:** {{date}}\n\n---\n\n## Topic\n\n\n\n## Key points\n\n- \n\n## Examples\n\n- \n\n## Questions\n\n- [ ] \n\n## Summary\n\n`,
  },
];

const CUSTOM_KEY = "notiz-custom-templates";
const CUSTOM_EVENT = "notiz-custom-templates-change";

let customCache: NoteTemplate[] | null = null;

function readCustom(): NoteTemplate[] {
  if (customCache) return customCache;
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    customCache = Array.isArray(parsed)
      ? parsed
          .filter(
            (item) =>
              item &&
              typeof item.id === "string" &&
              typeof item.title === "string" &&
              typeof item.body === "string",
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            description: String(item.description ?? "Saved from a note"),
            accent: "#e4ded2",
            category: "Mine" as const,
            body: item.body,
            custom: true,
          }))
      : [];
  } catch {
    customCache = [];
  }
  return customCache;
}

function writeCustom(templates: NoteTemplate[]) {
  customCache = templates;
  try {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify(
        templates.map(({ id, title, description, body }) => ({
          id,
          title,
          description,
          body,
        })),
      ),
    );
  } catch {
    // The in-memory copy still works for this run.
  }
  window.dispatchEvent(new Event(CUSTOM_EVENT));
}

function subscribeCustom(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CUSTOM_KEY) {
      customCache = null;
      listener();
    }
  };
  window.addEventListener(CUSTOM_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CUSTOM_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCustomTemplates(): NoteTemplate[] {
  return useSyncExternalStore(subscribeCustom, readCustom, readCustom);
}

export function saveCustomTemplate(title: string, body: string): NoteTemplate {
  const template: NoteTemplate = {
    id: `custom-${crypto.randomUUID()}`,
    title: title.trim() || "Untitled template",
    description: "Saved from a note",
    accent: "#e4ded2",
    category: "Mine",
    body,
    custom: true,
  };
  writeCustom([template, ...readCustom()]);
  return template;
}

export function deleteCustomTemplate(id: string) {
  writeCustom(readCustom().filter((template) => template.id !== id));
}

/** The template text with `{{date}}` and `{{day}}` replaced by today. */
export function resolveTemplateBody(template: NoteTemplate): string {
  const now = new Date();
  return template.body
    .replace(/\{\{date\}\}/g, format(now, "MMMM d, yyyy"))
    .replace(/\{\{day\}\}/g, format(now, "EEEE, MMMM d"));
}

export function createNoteFromTemplate(
  store: main.Store,
  template: NoteTemplate,
): string {
  const sessionId = createSession(store, template.title);
  store.setCell(
    "sessions",
    sessionId,
    "raw_md",
    JSON.stringify(md2json(resolveTemplateBody(template))),
  );
  return sessionId;
}

type InsertRequest = { sessionId: string; template: NoteTemplate };
const insertListeners = new Set<(request: InsertRequest) => void>();

// The note editor owns its document, so inserting goes through the mounted
// editor instead of writing to the store behind its back.
export function insertTemplateIntoNote(
  sessionId: string,
  template: NoteTemplate,
) {
  insertListeners.forEach((listener) => listener({ sessionId, template }));
}

export function onTemplateInsert(listener: (request: InsertRequest) => void) {
  insertListeners.add(listener);
  return () => {
    insertListeners.delete(listener);
  };
}
