import { describe, expect, test } from "vitest";

import {
  BUILT_IN_TEMPLATES,
  markdownToNoteContent,
  templateContent,
} from "./note-templates";

type Node = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: { type: string }[];
};

function walk(nodes: Node[], visit: (node: Node) => void) {
  for (const node of nodes) {
    visit(node);
    if (node.content) walk(node.content, visit);
  }
}

function text(node: Node): string {
  return node.text ?? (node.content ?? []).map(text).join("");
}

describe("built-in templates", () => {
  test("ids are unique and every template has content", () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.title.trim()).not.toBe("");
      expect(templateContent(template).length).toBeGreaterThan(0);
    }
  });

  for (const template of BUILT_IN_TEMPLATES) {
    describe(template.id, () => {
      const blocks = templateContent(template);

      test("fills in the date and leaves no placeholders", () => {
        let all = "";
        walk(blocks, (node) => {
          if (node.text) all += node.text;
        });
        expect(all).not.toContain("{{");
      });

      test("checkbox lines become real task items, not bullets with [ ]", () => {
        walk(blocks, (node) => {
          if (node.type === "listItem") {
            expect(text(node)).not.toMatch(/^\[( |x|X)\]/);
          }
        });

        const wantsTasks = template.body.includes("- [ ]");
        const taskItems: Node[] = [];
        walk(blocks, (node) => {
          if (node.type === "taskItem") taskItems.push(node);
        });
        if (wantsTasks) {
          expect(taskItems.length).toBeGreaterThan(0);
          for (const item of taskItems) {
            expect(item.attrs?.checked).toBe(false);
            expect(item.content?.[0]?.type).toBe("paragraph");
          }
        }
      });

      test("label lines are separate paragraphs, not run together", () => {
        for (const block of blocks) {
          if (block.type !== "paragraph") continue;
          const labels = (block.content ?? []).filter((n) =>
            n.marks?.some((m) => m.type === "bold"),
          );
          expect(labels.length).toBeLessThanOrEqual(1);
        }
      });

      test("never has two empty paragraphs in a row", () => {
        for (let i = 1; i < blocks.length; i++) {
          const both =
            blocks[i].type === "paragraph" &&
            blocks[i - 1].type === "paragraph" &&
            !text(blocks[i]).trim() &&
            !text(blocks[i - 1]).trim();
          expect(both).toBe(false);
        }
      });
    });
  }
});

describe("markdownToNoteContent", () => {
  test("converts a lone empty checkbox into a task item", () => {
    const [list] = markdownToNoteContent("- [ ] ");
    expect(list.type).toBe("taskList");
    expect(list.content?.[0]?.type).toBe("taskItem");
    expect(list.content?.[0]?.attrs?.checked).toBe(false);
  });

  test("keeps the text and checked state of filled checkboxes", () => {
    const [list] = markdownToNoteContent("- [ ] one\n- [x] two");
    expect(list.type).toBe("taskList");
    expect(list.content?.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(list.content?.map(text)).toEqual(["one", "two"]);
  });

  test("leaves ordinary bullets alone", () => {
    const [list] = markdownToNoteContent("- apple\n- pear");
    expect(list.type).toBe("bulletList");
  });
});
