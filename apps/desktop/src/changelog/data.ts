// @ts-ignore virtual module provided by ./vite.ts
import { latestContent, latestVersion } from "virtual:changelog";

import { processContent } from "@notiz/changelog";

export function getLatestVersion(): string | null {
  return latestVersion;
}

export function useChangelogContent(version: string) {
  if (version === latestVersion && latestContent) {
    const { content, date } = processContent(latestContent);
    return { content, date, loading: false };
  }

  return { content: null, date: null, loading: false };
}
