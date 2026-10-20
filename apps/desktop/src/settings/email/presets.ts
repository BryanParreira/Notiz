export type MailPreset = {
  id: string;
  label: string;
  host: string;
  port: number;
  helpUrl?: string;
  helpText?: string;
};

export const MAIL_PRESETS: MailPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    helpUrl: "https://myaccount.google.com/apppasswords",
    helpText: "Use an app password (2-Step Verification must be on).",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    host: "outlook.office365.com",
    port: 993,
    helpText:
      "Use an app password. Some work accounts block password sign-in; ask your admin.",
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    host: "imap.mail.me.com",
    port: 993,
    helpUrl: "https://account.apple.com/account/manage",
    helpText: "Use an app-specific password.",
  },
  {
    id: "yahoo",
    label: "Yahoo",
    host: "imap.mail.yahoo.com",
    port: 993,
    helpText: "Use an app password from Account Security.",
  },
  { id: "custom", label: "Other (IMAP)", host: "", port: 993 },
];

export function getPreset(id: string): MailPreset {
  return MAIL_PRESETS.find((p) => p.id === id) ?? MAIL_PRESETS[0];
}
