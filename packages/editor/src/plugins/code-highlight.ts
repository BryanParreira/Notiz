import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { type Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const LANGUAGES: [string, unknown][] = [
  ["bash", bash],
  ["cpp", cpp],
  ["css", css],
  ["go", go],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
];

for (const [name, definition] of LANGUAGES) {
  hljs.registerLanguage(name, definition as never);
}

const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  html: "xml",
  yml: "yaml",
  "c++": "cpp",
  c: "cpp",
  golang: "go",
};

export const CODE_LANGUAGE_OPTIONS = LANGUAGES.map(([name]) => name);

function resolveLanguage(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return hljs.getLanguage(name) ? name : null;
}

type Span = { from: number; to: number; className: string };

// Parses highlight.js output into offset ranges so they can become inline
// decorations without touching the document.
function toSpans(html: string): Span[] {
  const spans: Span[] = [];
  const stack: { start: number; className: string }[] = [];
  let offset = 0;
  const pattern = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match[1]) {
      stack.push({ start: offset, className: match[1] });
    } else if (match[2] !== undefined) {
      offset += decodeEntities(match[2]).length;
    } else {
      const open = stack.pop();
      if (open && offset > open.start) {
        spans.push({
          from: open.start,
          to: offset,
          className: open.className,
        });
      }
    }
  }
  return spans;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

const MAX_HIGHLIGHT_CHARS = 20_000;

// Cached per node: unchanged code blocks are not re-highlighted while the user
// types somewhere else in the note.
const spanCache = new WeakMap<PMNode, Span[]>();

function spansFor(node: PMNode, language: string): Span[] {
  const cached = spanCache.get(node);
  if (cached) return cached;
  const code = node.textContent;
  let spans: Span[] = [];
  if (code.length <= MAX_HIGHLIGHT_CHARS) {
    try {
      spans = toSpans(
        hljs.highlight(code, { language, ignoreIllegals: true }).value,
      );
    } catch {
      spans = [];
    }
  }
  spanCache.set(node, spans);
  return spans;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return !node.isTextblock;
    decorations.push(
      Decoration.widget(
        pos + 1,
        (view, getPos) => {
          const select = document.createElement("select");
          select.className = "code-language-picker";
          select.contentEditable = "false";
          select.setAttribute("aria-label", "Code language");
          for (const value of ["", ...CODE_LANGUAGE_OPTIONS]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value || "plain";
            select.append(option);
          }
          const current = resolveLanguage(String(node.attrs.language ?? ""));
          select.value = current ?? "";
          select.addEventListener("mousedown", (event) =>
            event.stopPropagation(),
          );
          select.addEventListener("change", () => {
            const nodePos = (getPos() ?? 1) - 1;
            const target = view.state.doc.nodeAt(nodePos);
            if (!target) return;
            view.dispatch(
              view.state.tr.setNodeMarkup(nodePos, undefined, {
                ...target.attrs,
                language: select.value,
              }),
            );
            view.focus();
          });
          return select;
        },
        { side: -1, key: `lang-${pos}-${node.attrs.language ?? ""}` },
      ),
    );

    const language = resolveLanguage(String(node.attrs.language ?? ""));
    if (language) {
      for (const span of spansFor(node, language)) {
        decorations.push(
          Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, {
            class: span.className,
          }),
        );
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const codeHighlightPluginKey = new PluginKey("codeHighlight");

export function codeHighlightPlugin() {
  return new Plugin({
    key: codeHighlightPluginKey,
    state: {
      init: (_config, state) => buildDecorations(state.doc),
      apply: (tr, previous) =>
        tr.docChanged ? buildDecorations(tr.doc) : previous,
    },
    props: {
      decorations(state) {
        return codeHighlightPluginKey.getState(state);
      },
    },
  });
}
