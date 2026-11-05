import { Trans } from "@lingui/react/macro";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { format, isThisYear, isToday, isYesterday, parseISO } from "date-fns";
import {
  ImageIcon,
  ImageOffIcon,
  FileTextIcon,
  ListPlusIcon,
  MailIcon,
  MailOpenIcon,
  PenLineIcon,
  Trash2Icon,
  RefreshCwIcon,
  ReplyIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { md2json } from "@notiz/editor/markdown";
import { commands as mailCommands } from "@notiz/plugin-mail";
import { cn } from "@notiz/utils";

import { openCompose, quoteForReply, replySubject } from "./compose";
import { EmailFrame, openExternalLink } from "./email-frame";
import { takePendingInboxSelection } from "./pending-selection";

import { appendToDailyNote } from "~/daily/append";
import { todayKey } from "~/daily/open-daily-tab";
import { useMailAccounts } from "~/settings/email";
import { StandardTabWrapper } from "~/shared/main";
import { showTransientToast } from "~/sidebar/toast/transient";
import * as main from "~/store/tinybase/store/main";
import { createSession } from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

const RECENT_LIMIT = 80;
const ACCOUNT_STORAGE_KEY = "notiz-mail-account";
const READ_STORAGE_KEY = "notiz-mail-opened";
const UNREAD_STORAGE_KEY = "notiz-mail-marked-unread";
const READ_STORAGE_MAX = 5000;

function loadAccountFilter(): string {
  try {
    return localStorage.getItem(ACCOUNT_STORAGE_KEY) ?? "all";
  } catch {
    return "all";
  }
}

function loadOpenedKeys(storageKey = READ_STORAGE_KEY): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveOpenedKeys(keys: Set<string>, storageKey = READ_STORAGE_KEY) {
  try {
    // Oldest first, so trimming drops the emails opened longest ago.
    localStorage.setItem(
      storageKey,
      JSON.stringify([...keys].slice(-READ_STORAGE_MAX)),
    );
  } catch {}
}
const TWO_MINUTES_MS = 2 * 60 * 1000;
const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/g;

type InboxMessage = {
  key: string;
  accountId: string;
  uid: number;
  subject: string;
  fromName: string;
  fromEmail: string;
  date: Date | null;
  seen: boolean;
};

function useInboxMessages(accountIds: string[]) {
  return useQuery({
    queryKey: ["mail-recent", accountIds],
    enabled: accountIds.length > 0,
    staleTime: TWO_MINUTES_MS,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<InboxMessage[]> => {
      const results = await Promise.all(
        accountIds.map((id) => mailCommands.recentMail(id, RECENT_LIMIT)),
      );

      const failed = results.find((r) => r.status === "error");
      if (failed && failed.status === "error") {
        if (!results.some((r) => r.status === "ok")) {
          throw new Error(failed.error);
        }
      }

      return results
        .flatMap((r, index) =>
          r.status === "ok"
            ? r.data.map((m) => ({
                key: `${accountIds[index]}-${m.uid}`,
                accountId: accountIds[index],
                uid: m.uid,
                subject: m.subject,
                fromName: m.from_name,
                fromEmail: m.from_email,
                date: m.date ? parseISO(m.date) : null,
                seen: m.seen,
              }))
            : [],
        )
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
    },
  });
}

function mailBodyQuery(accountId: string, uid: number) {
  return {
    queryKey: ["mail-body", accountId, uid],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await mailCommands.readMail(accountId, uid);
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
  };
}

const IMAGES_KEY = "notiz-mail-load-images";

function useLoadImages() {
  const [loadImages, setLoadImages] = useState(() => {
    try {
      return localStorage.getItem(IMAGES_KEY) !== "off";
    } catch {
      return true;
    }
  });

  const toggle = () =>
    setLoadImages((current) => {
      const next = !current;
      try {
        localStorage.setItem(IMAGES_KEY, next ? "on" : "off");
      } catch {
        // The choice just won't persist.
      }
      return next;
    });

  return [loadImages, toggle] as const;
}

function dayLabel(date: Date | null) {
  if (!date) return "Earlier";
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, MMM d");
}

function rowDate(date: Date | null) {
  if (!date) return "";
  if (isToday(date)) return format(date, "h:mm a");
  return format(date, isThisYear(date) ? "MMM d" : "MMM d, yyyy");
}

export function TabContentInbox() {
  const { data: accounts = [] } = useMailAccounts();
  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);
  const {
    data: messages = [],
    error,
    isFetching,
    refetch,
  } = useInboxMessages(accountIds);
  const openNew = useTabs((state) => state.openNew);

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [readKeys, setReadKeys] = useState<Set<string>>(loadOpenedKeys);
  useEffect(() => {
    saveOpenedKeys(readKeys);
  }, [readKeys]);
  // Emails the user marked unread again, so opening one earlier does not win.
  const [unreadKeys, setUnreadKeys] = useState<Set<string>>(() =>
    loadOpenedKeys(UNREAD_STORAGE_KEY),
  );
  useEffect(() => {
    saveOpenedKeys(unreadKeys, UNREAD_STORAGE_KEY);
  }, [unreadKeys]);
  // Emails moved to Trash disappear at once, before the next refresh.
  const [trashedKeys, setTrashedKeys] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();

  const isSeen = (message: InboxMessage) =>
    !unreadKeys.has(message.key) && (message.seen || readKeys.has(message.key));

  const setSeenState = (message: InboxMessage, seen: boolean) => {
    const flip = (set: Set<string>, add: boolean) => {
      const next = new Set(set);
      if (add) next.add(message.key);
      else next.delete(message.key);
      return next;
    };
    setReadKeys((prev) => flip(prev, seen));
    setUnreadKeys((prev) => flip(prev, !seen));
    void mailCommands
      .setMailSeen(message.accountId, message.uid, seen)
      .then((result) => {
        if (result.status === "error") {
          showTransientToast({
            description: "Could not update the message on your mail server.",
            variant: "error",
          });
        }
      });
  };

  const [storedAccount, setStoredAccount] = useState(loadAccountFilter);
  // A removed account falls back to the combined view.
  const accountFilter = accounts.some((a) => a.id === storedAccount)
    ? storedAccount
    : "all";
  const selectAccount = (id: string) => {
    setStoredAccount(id);
    setSelectedKey(null);
    try {
      localStorage.setItem(ACCOUNT_STORAGE_KEY, id);
    } catch {}
  };
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const selected = messages.find((m) => m.key === selectedKey) ?? null;

  const unreadByAccount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (trashedKeys.has(m.key)) continue;
      if (!(m.seen || readKeys.has(m.key)) || unreadKeys.has(m.key)) {
        counts.set(m.accountId, (counts.get(m.accountId) ?? 0) + 1);
      }
    }
    return counts;
  }, [messages, readKeys, unreadKeys, trashedKeys]);
  const unreadCount =
    accountFilter === "all"
      ? [...unreadByAccount.values()].reduce((sum, n) => sum + n, 0)
      : (unreadByAccount.get(accountFilter) ?? 0);
  const accountLabels = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.label || a.username])),
    [accounts],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages.filter((message) => {
      if (trashedKeys.has(message.key)) return false;
      if (accountFilter !== "all" && message.accountId !== accountFilter) {
        return false;
      }
      if (message.key === selectedKey) return true;
      if (unreadOnly && isSeen(message)) {
        return false;
      }
      if (!needle) return true;
      return `${message.fromName} ${message.fromEmail} ${message.subject}`
        .toLowerCase()
        .includes(needle);
    });
  }, [
    messages,
    accountFilter,
    query,
    unreadOnly,
    readKeys,
    unreadKeys,
    trashedKeys,
    selectedKey,
  ]);

  const groups = useMemo(() => {
    const result: { label: string; messages: InboxMessage[] }[] = [];
    for (const message of visible) {
      const label = dayLabel(message.date);
      const last = result[result.length - 1];
      if (last && last.label === label) last.messages.push(message);
      else result.push({ label, messages: [message] });
    }
    return result;
  }, [visible]);

  const select = (message: InboxMessage) => {
    setSelectedKey(message.key);
    if (!isSeen(message)) setSeenState(message, true);
  };

  const trash = async (message: InboxMessage) => {
    const index = visible.findIndex((m) => m.key === message.key);
    const next = visible[index + 1] ?? visible[index - 1] ?? null;
    setTrashedKeys((prev) => new Set(prev).add(message.key));
    setSelectedKey(next?.key ?? null);

    const result = await mailCommands.trashMail(message.accountId, message.uid);
    if (result.status === "error") {
      setTrashedKeys((prev) => {
        const restored = new Set(prev);
        restored.delete(message.key);
        return restored;
      });
      showTransientToast({
        description: `Could not move to Trash: ${result.error}`,
        variant: "error",
      });
      return;
    }
    showTransientToast({ description: "Moved to Trash" });
    void queryClient.invalidateQueries({ queryKey: ["mail-recent"] });
  };

  const composeAccount =
    accounts.find((a) => a.id === accountFilter) ?? accounts[0];

  // An email opened from Home is picked once the list has loaded.
  useEffect(() => {
    if (isFetching || messages.length === 0) return;

    const key = takePendingInboxSelection();
    if (key && messages.some((message) => message.key === key)) {
      setSelectedKey(key);
      const pending = messages.find((message) => message.key === key);
      if (pending && !isSeen(pending)) setSeenState(pending, true);
    }
  }, [isFetching, messages]);

  // Keep the selected row in view by scrolling only the list; scrollIntoView
  // can also move ancestor containers and shift the whole layout.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !row) return;

    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) {
      list.scrollTop -= listBox.top - rowBox.top + 8;
    } else if (rowBox.bottom > listBox.bottom) {
      list.scrollTop += rowBox.bottom - listBox.bottom + 8;
    }
  }, [selectedKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }

      if (e.key === "Escape") {
        setSelectedKey(null);
        return;
      }

      if (selected && (e.key === "#" || e.key === "Delete")) {
        e.preventDefault();
        void trash(selected);
        return;
      }
      if (selected && e.key === "u") {
        e.preventDefault();
        setSeenState(selected, !isSeen(selected));
        return;
      }
      if (e.key === "c") {
        e.preventDefault();
        void openCompose(composeAccount, {});
        return;
      }

      if (/^[1-9]$/.test(e.key) && accounts.length > 1) {
        const index = Number(e.key) - 1;
        if (index === 0) selectAccount("all");
        else if (accounts[index - 1]) selectAccount(accounts[index - 1].id);
        return;
      }

      const step =
        e.key === "ArrowDown" || e.key === "j"
          ? 1
          : e.key === "ArrowUp" || e.key === "k"
            ? -1
            : 0;
      if (step === 0 || visible.length === 0) return;

      e.preventDefault();
      const current = visible.findIndex((m) => m.key === selectedKey);
      const next =
        visible[Math.min(Math.max(current + step, 0), visible.length - 1)];
      if (next) select(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <StandardTabWrapper>
      <div className="flex h-full min-h-0">
        <div
          className={cn([
            "flex h-full min-h-0 flex-col",
            selected ? "w-[44%] max-w-[460px] min-w-[320px]" : "w-full",
          ])}
        >
          <header className="flex shrink-0 items-end justify-between gap-4 px-8 pt-12 pb-5">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="font-display text-foreground flex items-center gap-3 text-4xl leading-none">
                <Trans>Inbox</Trans>
                {unreadCount > 0 && (
                  <span className="bg-primary text-primary-foreground rounded-full px-2.5 py-1 font-sans text-xs font-medium">
                    {unreadCount} <Trans>unread</Trans>
                  </span>
                )}
              </h1>
              {!selected && (
                <p className="text-muted-foreground text-sm">
                  <Trans>
                    Read-only mail from your own account. Nothing leaves this
                    device.
                  </Trans>
                </p>
              )}
            </div>
            {accounts.length > 0 && (
              <button
                type="button"
                aria-label="New email"
                title="New email (C)"
                onClick={() => void openCompose(composeAccount, {})}
                className="text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 rounded-full p-2 transition-colors"
              >
                <PenLineIcon className="size-4" />
              </button>
            )}
            {accounts.length > 0 && (
              <button
                type="button"
                aria-label="Refresh"
                onClick={() => void refetch()}
                className="text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 rounded-full p-2 transition-colors"
              >
                <RefreshCwIcon
                  className={cn(["size-4", isFetching && "animate-spin"])}
                />
              </button>
            )}
          </header>

          {accounts.length > 1 && (
            <div
              role="tablist"
              aria-label="Inboxes"
              className="flex shrink-0 flex-wrap items-center gap-1 px-8 pb-3"
            >
              {[
                {
                  id: "all",
                  label: "All inboxes",
                  unread: [...unreadByAccount.values()].reduce(
                    (s, n) => s + n,
                    0,
                  ),
                },
                ...accounts.map((a) => ({
                  id: a.id,
                  label: a.label || a.username,
                  unread: unreadByAccount.get(a.id) ?? 0,
                })),
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={accountFilter === tab.id}
                  onClick={() => selectAccount(tab.id)}
                  className={cn([
                    "flex max-w-full min-w-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors",
                    accountFilter === tab.id
                      ? "bg-foreground text-background font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  ])}
                >
                  <span className="max-w-52 truncate">{tab.label}</span>
                  {tab.unread > 0 && (
                    <span
                      className={cn([
                        "rounded-full px-1.5 text-[11px] leading-4 tabular-nums",
                        accountFilter === tab.id
                          ? "bg-background/20"
                          : "bg-primary text-primary-foreground",
                      ])}
                    >
                      {tab.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {accounts.length > 0 && messages.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 px-8 pb-3">
              <label className="border-border bg-card focus-within:border-primary/50 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border px-3 transition-colors">
                <SearchIcon className="text-muted-foreground size-4 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search mail"
                  aria-label="Search mail"
                  className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </label>
              <div className="border-border bg-card flex h-9 shrink-0 items-center rounded-full border p-0.5">
                {([false, true] as const).map((only) => (
                  <button
                    key={String(only)}
                    type="button"
                    onClick={() => setUnreadOnly(only)}
                    className={cn([
                      "h-full rounded-full px-3 text-xs transition-colors",
                      unreadOnly === only
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    ])}
                  >
                    {only ? <Trans>Unread</Trans> : <Trans>All</Trans>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            ref={listRef}
            className="scroll-fade-y min-h-0 flex-1 overflow-y-auto px-5 pb-24"
          >
            {accounts.length === 0 ? (
              <section className="border-border mx-3 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
                <MailIcon className="text-muted-foreground size-6" />
                <p className="text-muted-foreground max-w-sm text-sm">
                  <Trans>
                    Connect an email account to read your mail next to your
                    notes. It is optional and read-only.
                  </Trans>
                </p>
                <button
                  type="button"
                  onClick={() =>
                    openNew({ type: "settings", state: { tab: "email" } })
                  }
                  className="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm transition-opacity hover:opacity-90"
                >
                  <Trans>Connect email</Trans>
                </button>
              </section>
            ) : error ? (
              <div className="flex flex-col items-start gap-3 px-3">
                <p className="text-destructive text-sm">
                  {error instanceof Error ? error.message : String(error)}
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full px-3 py-1.5 text-sm transition-colors"
                >
                  <Trans>Try again</Trans>
                </button>
              </div>
            ) : groups.length === 0 ? (
              <p className="text-muted-foreground px-3 py-8 text-sm">
                {isFetching ? (
                  <Trans>Checking your inbox…</Trans>
                ) : query.trim() ? (
                  <Trans>No mail matches your search.</Trans>
                ) : unreadOnly ? (
                  <Trans>You're all caught up.</Trans>
                ) : (
                  <Trans>Nothing in your inbox.</Trans>
                )}
              </p>
            ) : (
              groups.map((group) => (
                <section
                  key={group.label}
                  className="flex flex-col gap-0.5 pb-4"
                >
                  <h2 className="text-muted-foreground px-3 pb-1.5 text-sm">
                    {group.label}
                  </h2>
                  {group.messages.map((message) => (
                    <MessageRow
                      key={message.key}
                      message={message}
                      selected={message.key === selectedKey}
                      seen={isSeen(message)}
                      accountLabel={
                        accountFilter === "all" && accounts.length > 1
                          ? accountLabels.get(message.accountId)
                          : undefined
                      }
                      onSelect={() => select(message)}
                    />
                  ))}
                </section>
              ))
            )}
          </div>
        </div>

        {selected && (
          <MessagePreview
            message={selected}
            account={accounts.find((a) => a.id === selected.accountId)}
            seen={isSeen(selected)}
            onToggleSeen={() => setSeenState(selected, !isSeen(selected))}
            onTrash={() => void trash(selected)}
            onClose={() => setSelectedKey(null)}
          />
        )}
      </div>
    </StandardTabWrapper>
  );
}

function MessageRow({
  message,
  selected,
  seen,
  accountLabel,
  onSelect,
}: {
  message: InboxMessage;
  selected: boolean;
  seen: boolean;
  accountLabel?: string;
  onSelect: () => void;
}) {
  const sender = message.fromName || message.fromEmail;
  const queryClient = useQueryClient();

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={() =>
        void queryClient.prefetchQuery(
          mailBodyQuery(message.accountId, message.uid),
        )
      }
      aria-current={selected ? "true" : undefined}
      className={cn([
        "flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/60",
      ])}
    >
      <Avatar name={sender} className="size-9 text-sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span
            className={cn([
              "truncate text-sm",
              seen ? "text-muted-foreground" : "text-foreground font-medium",
            ])}
          >
            {sender}
          </span>
          {!seen && (
            <span className="bg-primary size-1.5 shrink-0 rounded-full" />
          )}
        </span>
        <span
          className={cn([
            "truncate text-sm",
            seen ? "text-muted-foreground/80" : "text-foreground",
          ])}
        >
          {message.subject || <Trans>(no subject)</Trans>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-muted-foreground text-xs">
          {rowDate(message.date)}
        </span>
        {accountLabel && (
          <span className="text-muted-foreground/70 max-w-24 truncate text-[10px]">
            {accountLabel}
          </span>
        )}
      </span>
    </button>
  );
}

const AVATAR_HUES = [25, 80, 140, 200, 280, 340];

function avatarHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
}

function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = avatarHue(name);

  return (
    <span
      style={{
        backgroundColor: `hsl(${hue} 32% 90%)`,
        color: `hsl(${hue} 34% 30%)`,
      }}
      className={cn([
        "flex shrink-0 items-center justify-center rounded-full font-medium uppercase",
        className,
      ])}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn([
        "text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
        "hover:bg-accent disabled:opacity-50",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      ])}
    >
      {children}
    </button>
  );
}

function MessagePreview({
  message,
  account,
  seen,
  onToggleSeen,
  onTrash,
  onClose,
}: {
  message: InboxMessage;
  account?: { host: string; username: string };
  seen: boolean;
  onToggleSeen: () => void;
  onTrash: () => void;
  onClose: () => void;
}) {
  const { data, isPending, error, refetch } = useQuery(
    mailBodyQuery(message.accountId, message.uid),
  );

  const sender = message.fromName || message.fromEmail;
  const [loadImages, toggleImages] = useLoadImages();
  const store = main.UI.useStore(main.STORE_ID);
  const openNew = useTabs((state) => state.openNew);

  const saveAsNote = () => {
    if (!store) return;
    const body = data?.text ?? htmlToText(data?.html) ?? "";
    const markdown = `# ${message.subject || "(no subject)"}\n\n**From:** ${sender} <${message.fromEmail}>${
      message.date
        ? `\n\n**Date:** ${format(message.date, "MMM d, yyyy · h:mm a")}`
        : ""
    }\n\n${body.slice(0, 20000)}`;
    const sessionId = createSession(store, message.subject || "(no subject)");
    store.setCell(
      "sessions",
      sessionId,
      "raw_md",
      JSON.stringify(md2json(markdown)),
    );
    openNew({ type: "sessions", id: sessionId });
  };

  const addTask = () => {
    if (!store) return;
    appendToDailyNote(
      store as main.Store,
      todayKey(),
      `- [ ] Reply to ${sender}: ${message.subject || "(no subject)"}`,
    );
    showTransientToast({ description: "Added to today's page" });
  };

  const reply = () => {
    const original = data?.text ?? htmlToText(data?.html) ?? "";
    void openCompose(account, {
      to: message.fromEmail,
      subject: replySubject(message.subject),
      body: quoteForReply(
        `${sender} <${message.fromEmail}>`,
        message.date,
        original,
      ),
    });
  };

  return (
    <aside
      aria-label="Message preview"
      className="border-border bg-card/50 flex h-full min-h-0 min-w-0 flex-1 flex-col border-l"
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={reply}
          className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-opacity hover:opacity-90"
        >
          <ReplyIcon className="size-4" />
          <Trans>Reply</Trans>
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarButton
            label={seen ? "Mark as unread (U)" : "Mark as read (U)"}
            onClick={onToggleSeen}
          >
            {seen ? (
              <MailIcon className="size-4" />
            ) : (
              <MailOpenIcon className="size-4" />
            )}
          </ToolbarButton>
          <ToolbarButton label="Add task to today's page" onClick={addTask}>
            <ListPlusIcon className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Save as note"
            onClick={saveAsNote}
            disabled={isPending}
          >
            <FileTextIcon className="size-4" />
          </ToolbarButton>
          {data?.html && (
            <ToolbarButton
              label={
                loadImages
                  ? "Images are on. Click to block them."
                  : "Images are blocked. Click to load them."
              }
              onClick={toggleImages}
            >
              {loadImages ? (
                <ImageIcon className="size-4" />
              ) : (
                <ImageOffIcon className="size-4" />
              )}
            </ToolbarButton>
          )}
          <ToolbarButton label="Move to Trash (#)" onClick={onTrash} danger>
            <Trash2Icon className="size-4" />
          </ToolbarButton>
          <span className="bg-border mx-1 h-4 w-px" />
          <ToolbarButton label="Close preview" onClick={onClose}>
            <XIcon className="size-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto px-8 pt-2 pb-16">
        <h2 className="font-display text-foreground text-2xl leading-snug">
          {message.subject || <Trans>(no subject)</Trans>}
        </h2>

        <div className="mt-5 flex items-center gap-3">
          <Avatar name={sender} className="size-10 text-base" />
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground truncate text-sm font-medium">
              {sender}
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {message.fromEmail}
              {data?.to ? ` · to ${data.to}` : ""}
            </span>
          </div>
          {message.date && (
            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
              {format(message.date, "MMM d, yyyy · h:mm a")}
            </span>
          )}
        </div>

        <div className="border-border my-6 border-t" />

        {isPending ? (
          <div className="flex flex-col gap-3">
            {[90, 100, 70, 95, 60].map((width, index) => (
              <div
                key={index}
                style={{ width: `${width}%` }}
                className="bg-muted h-3.5 animate-pulse rounded-full"
              />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-destructive text-sm">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full px-3 py-1.5 text-sm transition-colors"
            >
              <Trans>Try again</Trans>
            </button>
          </div>
        ) : data.html ? (
          <>
            <EmailFrame html={data.html} loadImages={loadImages} />
            {data.truncated && (
              <p className="text-muted-foreground mt-6 text-xs">
                <Trans>
                  This message is long, so some content may be missing.
                </Trans>
              </p>
            )}
          </>
        ) : data.text ? (
          <>
            <MessageText text={data.text} />
            {data.truncated && (
              <p className="text-muted-foreground mt-6 text-xs">
                <Trans>
                  This message is long, so only the beginning is shown.
                </Trans>
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            <Trans>This message has no readable text.</Trans>
          </p>
        )}
      </div>
    </aside>
  );
}

function htmlToText(html: string | null | undefined) {
  if (!html) return null;
  // DOMParser builds an inert document: nothing in the message runs or loads.
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? null;
}

// Messages are shown as plain text with clickable links. HTML is never
// rendered, so remote images and trackers inside a message are never loaded.
function MessageText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);

  return (
    <div className="text-foreground text-[15px] leading-relaxed break-words whitespace-pre-wrap">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <button
            key={index}
            type="button"
            onClick={() => void openExternalLink(part)}
            className="text-primary hover:underline"
          >
            {part}
          </button>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </div>
  );
}
