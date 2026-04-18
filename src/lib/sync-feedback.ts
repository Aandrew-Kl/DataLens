import { addToast } from "@/lib/ui/toast-bus";

type SyncableRecord = { synced?: boolean };

const SYNC_FAILURE_DEBOUNCE_MS = 120;

export function clearSyncFlag<T extends SyncableRecord>(record: T): T {
  const { synced: _synced, ...rest } = record;
  return rest as T;
}

export function markPendingSync<T extends SyncableRecord>(record: T): T {
  return { ...record, synced: false };
}

export function hasPendingSync(record: SyncableRecord): boolean {
  return record.synced === false;
}

export function createSyncFailureNotifier(entityLabel: string) {
  let pendingCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (count = 1) => {
    pendingCount += count;

    if (timer !== null) {
      return;
    }

    timer = globalThis.setTimeout(() => {
      const total = pendingCount;
      pendingCount = 0;
      timer = null;

      addToast({
        variant: "error",
        message: `Failed to sync ${total} ${entityLabel}${total === 1 ? "" : "s"}. Retry manually.`,
      });
    }, SYNC_FAILURE_DEBOUNCE_MS);
  };
}
