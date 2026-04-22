import { useEffect, useMemo, useState } from "react";

import type { ColumnProfile } from "@/types/dataset";

import { loadAdvancedProfile } from "./queries";
import type { LoadState } from "./types";

export function useAdvancedProfile(
  tableName: string,
  column: ColumnProfile,
  rowCount: number,
) {
  const requestKey = useMemo(
    () => JSON.stringify({ tableName, rowCount, column }),
    [column, rowCount, tableName],
  );

  const [loadState, setLoadState] = useState<LoadState>({
    key: "",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await loadAdvancedProfile(tableName, column, rowCount);
        if (cancelled) return;
        setLoadState({ key: requestKey, data, error: null });
      } catch (error) {
        if (cancelled) return;
        setLoadState({
          key: requestKey,
          data: null,
          error: error instanceof Error
            ? error.message
            : "Failed to profile the selected column.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [column, requestKey, rowCount, tableName]);

  const data = loadState.key === requestKey ? loadState.data : null;
  const loading = loadState.key !== requestKey;

  return { data, loading, error: loadState.error };
}

export function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
}
