import type { ReactNode } from "react";

export function SettingsPageTitle({ title }: { title: ReactNode }) {
  return (
    <h2 className="font-display text-3xl leading-none tracking-normal">
      {title}
    </h2>
  );
}
