import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { TooltipProvider } from "@notiz/ui/components/ui/tooltip";

import {
  getOnboardingNeeded,
  isShellEntryPath,
  normalizeAppPath,
  resolveShellEntryPath,
} from "./-resolve-entry-path";

import { useDeeplinkHandler } from "~/shared/hooks/useDeeplinkHandler";

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    const pathname = normalizeAppPath(location.pathname);
    const onboardingNeeded = await getOnboardingNeeded();

    if (pathname === "/app/onboarding") {
      if (!onboardingNeeded) {
        throw redirect({ to: await resolveShellEntryPath() });
      }
      return;
    }

    if (onboardingNeeded && isShellEntryPath(pathname)) {
      throw redirect({ to: "/app/onboarding" });
    }
  },
  component: Component,
});

function Component() {
  useDeeplinkHandler();

  return (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  );
}
