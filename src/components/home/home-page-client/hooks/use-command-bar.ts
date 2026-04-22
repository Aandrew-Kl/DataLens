import { useCallback, useMemo } from "react";
import {
  ExternalLink as GithubIcon,
  FileText,
  Settings,
  Upload,
} from "lucide-react";

import type { AppTab } from "@/components/home/types";
import type { Command as CommandBarCommand } from "@/components/ui/command-bar";
import { runQuery } from "@/lib/duckdb/client";
import { sanitizeTableName } from "@/lib/utils/formatters";
import type { DatasetMeta } from "@/types/dataset";

import { TABS } from "../constants";

interface CommandBarOptions {
  activeDataset: DatasetMeta | undefined;
  setShowCommandPalette: (open: boolean) => void;
  setShowSettings: (open: boolean) => void;
  onNewDataset: () => void;
  onToggleTheme: () => void;
  setActiveTab: (tab: AppTab) => void;
}

export function useCommandBar({
  activeDataset,
  setShowCommandPalette,
  setShowSettings,
  onNewDataset,
  onToggleTheme,
  setActiveTab,
}: CommandBarOptions) {
  const commandBarCommands: CommandBarCommand[] = useMemo(
    () => [
      {
        id: "new-dataset",
        label: "Upload dataset",
        category: "File" as const,
        description: "Load a new file into the current workspace.",
        keywords: ["import", "csv", "dataset", "file"],
        icon: Upload,
      },
      {
        id: "settings",
        label: "Open settings",
        category: "Edit" as const,
        description: "Adjust theme and workspace preferences.",
        keywords: ["preferences", "theme"],
        icon: Settings,
      },
      {
        id: "export-csv",
        label: "Export CSV",
        category: "Export" as const,
        description: "Download the current dataset as CSV.",
        keywords: ["download", "csv", "export"],
        icon: Upload,
      },
      {
        id: "export-json",
        label: "Export JSON",
        category: "Export" as const,
        description: "Download the current dataset as JSON.",
        keywords: ["download", "json", "export"],
        icon: FileText,
      },
      {
        id: "github",
        label: "Open GitHub",
        category: "View" as const,
        description: "Open the DataLens repository.",
        keywords: ["repo", "source", "issues"],
        icon: GithubIcon,
      },
      ...TABS.map((tab) => ({
        id: `tab:${tab.id}`,
        label: `Open ${tab.label}`,
        category: "View" as const,
        description: `Jump to the ${tab.label.toLowerCase()} workspace.`,
        keywords: [tab.id, tab.label.toLowerCase(), "workspace"],
        icon: tab.icon,
      })),
    ],
    [],
  );

  const handleCommandAction = useCallback(
    (action: string) => {
      setShowCommandPalette(false);

      switch (action) {
        case "new-dataset":
          onNewDataset();
          break;
        case "toggle-theme":
          onToggleTheme();
          break;
        case "settings":
          setShowSettings(true);
          break;
        case "export-csv":
          if (activeDataset) {
            const nextTableName = sanitizeTableName(activeDataset.fileName);
            runQuery(`SELECT * FROM "${nextTableName}" LIMIT 10000`).then(
              (data) => {
                import("@/lib/utils/export").then(({ exportToCSV }) => {
                  exportToCSV(data, activeDataset.fileName.replace(/\.\w+$/, ""));
                });
              },
            );
          }
          break;
        case "export-json":
          if (activeDataset) {
            const nextTableName = sanitizeTableName(activeDataset.fileName);
            runQuery(`SELECT * FROM "${nextTableName}" LIMIT 10000`).then(
              (data) => {
                import("@/lib/utils/export").then(({ exportToJSON }) => {
                  exportToJSON(data, activeDataset.fileName.replace(/\.\w+$/, ""));
                });
              },
            );
          }
          break;
        case "github":
          window.open("https://github.com/Aandrew-Kl/DataLens", "_blank");
          break;
        default:
          break;
      }
    },
    [
      activeDataset,
      onNewDataset,
      onToggleTheme,
      setShowCommandPalette,
      setShowSettings,
    ],
  );

  const handleCommandBarExecute = useCallback(
    (command: CommandBarCommand) => {
      if (command.id.startsWith("tab:")) {
        setActiveTab(command.id.replace("tab:", "") as AppTab);
        return;
      }

      handleCommandAction(command.id);
    },
    [handleCommandAction, setActiveTab],
  );

  return {
    commandBarCommands,
    handleCommandAction,
    handleCommandBarExecute,
  };
}
