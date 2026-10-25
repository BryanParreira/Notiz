// Opening an email from chat switches to the Inbox tab, which has to know which
// message to show once it has loaded. The tab may not exist yet, so the choice
// waits here until the Inbox takes it.
let pendingKey: string | null = null;

export function selectInboxMessageOnOpen(id: string) {
  // Chat ids look like "account:uid"; the Inbox keys rows "account-uid".
  const split = id.lastIndexOf(":");
  pendingKey =
    split > 0 ? `${id.slice(0, split)}-${id.slice(split + 1)}` : null;
}

export function takePendingInboxSelection(): string | null {
  const key = pendingKey;
  pendingKey = null;
  return key;
}
