import { Icon } from "@iconify-icon/react";
import { LinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { OutlookIcon } from "@notiz/ui/components/icons/outlook";

export type CalendarProvider = {
  disabled: boolean;
  id: string;
  displayName: string;
  icon: ReactNode;
  badge?: string | null;
  platform?: "macos" | "all";
  docsPath: string;
  nangoIntegrationId?: string;
};

const _PROVIDERS = [
  {
    disabled: false,
    id: "apple",
    displayName: "Apple Calendar",
    badge: "",
    icon: (
      <img
        src="/assets/apple-calendar.png"
        alt="Apple Calendar"
        className="size-5 rounded-[4px] object-cover"
      />
    ),
    platform: "macos",
    docsPath: "https://github.com/BryanParreira/Notiz",
    nangoIntegrationId: undefined,
  },
  {
    disabled: false,
    id: "google",
    displayName: "Google",
    badge: "",
    icon: <Icon icon="logos:google-calendar" width={16} height={16} />,
    platform: "all",
    docsPath: "https://github.com/BryanParreira/Notiz",
    nangoIntegrationId: "google-calendar",
  },
  {
    disabled: false,
    id: "outlook",
    displayName: "Outlook",
    badge: "",
    icon: <OutlookIcon size={16} />,
    platform: "all",
    docsPath: "https://github.com/BryanParreira/Notiz",
    nangoIntegrationId: "outlook",
  },
  {
    disabled: false,
    id: "ics",
    displayName: "Calendar link",
    badge: "",
    icon: <LinkIcon size={16} />,
    platform: "all",
    docsPath: "https://github.com/BryanParreira/Notiz",
    nangoIntegrationId: "ics",
  },
] as const satisfies readonly CalendarProvider[];

export const PROVIDERS = [..._PROVIDERS];
