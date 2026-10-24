import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commands as openerCommands } from "@notiz/plugin-opener2";

// A second line of defence behind the sanitizer: even if markup slipped
// through, the frame can neither run scripts nor contact anything except image
// servers, and only when images are switched on.
function framePolicy(loadImages: boolean) {
  return [
    "default-src 'none'",
    `img-src data: ${loadImages ? "https:" : ""}`.trim(),
    "style-src 'unsafe-inline'",
    "font-src data:",
  ].join("; ");
}

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "script",
      "iframe",
      "frame",
      "frameset",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "meta",
      "link",
      "base",
      "title",
    ],
    FORBID_ATTR: ["ping", "formaction"],
    // Most newsletters keep their CSS in <head>, which the sanitizer drops
    // unless the body is forced to hold it; without it they render unstyled.
    FORCE_BODY: true,
  });
}

export function buildEmailDocument(html: string, loadImages: boolean): string {
  const clean = sanitizeEmailHtml(html);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${framePolicy(loadImages)}">
<meta name="color-scheme" content="light">
<style>
html,body{margin:0;padding:0;background:#fff;color:#1f1f1f;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;word-break:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
table{max-width:100%}
a{color:#0b57d0}
blockquote{margin:.5em 0 .5em .8em;padding-left:.8em;border-left:3px solid #ddd;color:#555}
</style></head><body>${clean}</body></html>`;
}

export function EmailFrame({
  html,
  loadImages,
}: {
  html: string;
  loadImages: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const srcDoc = useMemo(
    () => buildEmailDocument(html, loadImages),
    [html, loadImages],
  );

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(120, doc.documentElement.scrollHeight));
  }, []);

  useEffect(() => {
    setHeight(240);
  }, [srcDoc]);

  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    measure();

    // Links open in the user's browser, never inside the frame.
    doc.addEventListener("click", async (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        await openerCommands.openUrl(href, null);
      }
    });

    if (doc.body && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(measure).observe(doc.body);
    }
  }, [measure]);

  return (
    <iframe
      ref={frameRef}
      title="Message"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={handleLoad}
      style={{ height }}
      className="border-border block w-full rounded-xl border bg-white"
    />
  );
}
