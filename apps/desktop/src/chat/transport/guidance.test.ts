import { describe, expect, it } from "vitest";

import {
  buildProfileBlock,
  buildToolGuidance,
  SMALL_TALK_INSTRUCTION,
} from "./guidance";

describe("buildProfileBlock", () => {
  it("returns nothing when the user shared nothing", () => {
    expect(buildProfileBlock("", "")).toBeNull();
    expect(buildProfileBlock("  ", undefined)).toBeNull();
  });

  it("includes the name and what the user said about themselves", () => {
    const block = buildProfileBlock("Bryan", "I run a bakery");
    expect(block).toContain("Bryan");
    expect(block).toContain("I run a bakery");
  });

  it("flattens line breaks and caps length so it stays one short block", () => {
    const block = buildProfileBlock("Bry\nan", `${"a ".repeat(500)}`) ?? "";
    expect(block).not.toContain("\n");
    expect(block.length).toBeLessThan(700);
  });
});

describe("greeting prompt", () => {
  it("never promises calendar or email the model was not given", () => {
    expect(buildToolGuidance([])).not.toMatch(/can see the user's calendar/i);
    expect(buildToolGuidance([])).toMatch(/never make any up/i);
  });

  it("tells the model a greeting has no data to talk about", () => {
    expect(SMALL_TALK_INSTRUCTION).toMatch(/Do not mention meetings/);
  });
});

describe("skill prompts", () => {
  it("keeps a greeting prompt small and sends only the rules a request needs", () => {
    const core = buildToolGuidance([]);
    expect(core.length).toBeLessThan(900);

    const drafting = buildToolGuidance(["writing"]);
    expect(drafting).toMatch(/ready to send/);
    expect(drafting).not.toMatch(/search_sessions/);
    expect(drafting).not.toMatch(/create_calendar_event/);
  });

  it("gives note creation its own short rules", () => {
    const tasks = buildToolGuidance(["tasks"]);
    expect(tasks).toMatch(/create_note/);
    expect(tasks).not.toMatch(/edit_note/);
  });
});
