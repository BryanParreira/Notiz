const MAX_MAILTO_LENGTH = 1800;

export function buildFollowUpMailto({
  recipients,
  subject,
  body,
}: {
  recipients: string[];
  subject: string;
  body: string;
}) {
  const to = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))]
    .map(encodeURIComponent)
    .join(",");

  const params = (text: string) =>
    `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  // Mail apps and OS handlers reject very long mailto URLs, so trim the body
  // rather than failing to open the draft at all.
  let text = body;
  let url = `mailto:${to}?${params(text)}`;
  while (url.length > MAX_MAILTO_LENGTH && text.length > 0) {
    text = text.slice(0, Math.floor(text.length * 0.8)).trimEnd();
    url = `mailto:${to}?${params(`${text}…`)}`;
  }

  return url;
}
