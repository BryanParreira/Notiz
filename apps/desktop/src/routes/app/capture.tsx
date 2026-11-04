import { createFileRoute } from "@tanstack/react-router";

import { CapturePanel } from "~/capture";

export const Route = createFileRoute("/app/capture")({
  component: CapturePanel,
});
