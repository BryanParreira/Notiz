import { createFileRoute } from "@tanstack/react-router";

import { TrayPanel } from "~/tray";

export const Route = createFileRoute("/app/tray")({
  component: TrayPanel,
});
