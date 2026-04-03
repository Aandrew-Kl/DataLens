"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

const GLASS_PANEL_CLASS =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";

export interface TreeNode<T = unknown> {
  id: string;
  label: string;
  icon?: ReactNode;
  data?: T;
  children?: TreeNode<T>[];
  disabled?: boolean;
}

interface TreeViewProps<T = unknown> {
  nodes: TreeNode<T>[];
  defaultExpandedIds?: string[];
  defaultSelectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  className?: string;
}

interface TreeNodeMeta<T> {
  node: TreeNode<T>;
  depth: number;
  parentId: string | null;
}

interface FlattenedNode<T> extends TreeNodeMeta<T> {
  expanded: boolean;
  hasChildren: boolean;
  matchesSearch: boolean;
}

function buildTreeIndex<T>(
  nodes: TreeNode<T>[],
  depth = 0,
  parentId: string | null = null,
  index: Record<string, TreeNodeMeta<T>> = {},
) {
  for (const node of nodes) {
    index[node.id] = {
      node,
      depth,
      parentId,
    };

    if (node.children?.length) {
      buildTreeIndex(node.children, depth + 1, node.id, index);
    }
  }

  return index;
}

function filterTree<T>(nodes: TreeNode<T>[], query: string): TreeNode<T>[] {
  if (!query.trim()) {
    return nodes;
  }

  const lowerQuery = query.toLowerCase();

  return nodes.reduce<TreeNode<T>[]>((accumulator, node) => {
    const children = filterTree(node.children ?? [], query);
    const matches = node.label.toLowerCase().includes(lowerQuery);

    if (matches || children.length) {
      accumulator.push({
        ...node,
        children,
      });
    }

    return accumulator;
  }, []);
}

function collectExpandedIds<T>(nodes: TreeNode<T>[], accumulator = new Set<string>()) {
  for (const node of nodes) {
    if (node.children?.length) {
      accumulator.add(node.id);
      collectExpandedIds(node.children, accumulator);
    }
  }

  return accumulator;
}

function flattenTree<T>(
  nodes: TreeNode<T>[],
  expandedIds: Set<string>,
  query: string,
  depth = 0,
  parentId: string | null = null,
  rows: FlattenedNode<T>[] = [],
) {
  const lowerQuery = query.trim().toLowerCase();

  for (const node of nodes) {
    const hasChildren = Boolean(node.children?.length);
    const expanded = hasChildren && expandedIds.has(node.id);
    rows.push({
      node,
      depth,
      parentId,
      expanded,
      hasChildren,
      matchesSearch: lowerQuery ? node.label.toLowerCase().includes(lowerQuery) : false,
    });

    if (hasChildren && expanded) {
      flattenTree(node.children ?? [], expandedIds, query, depth + 1, node.id, rows);
    }
  }

  return rows;
}

function collectDescendantIds<T>(node: TreeNode<T>): string[] {
  const ids = [node.id];

  for (const child of node.children ?? []) {
    ids.push(...collectDescendantIds(child));
  }

  return ids;
}

function getCheckboxState<T>(node: TreeNode<T>, selectedIds: Set<string>) {
  const descendantIds = collectDescendantIds(node);
  const selectedCount = descendantIds.filter((id) => selectedIds.has(id)).length;

  if (selectedCount === 0) {
    return "unchecked" as const;
  }

  if (selectedCount === descendantIds.length) {
    return "checked" as const;
  }

  return "indeterminate" as const;
}

function TreeCheckbox({
  label,
  state,
  disabled,
  onChange,
}: {
  label: string;
  state: "checked" | "indeterminate" | "unchecked";
  disabled: boolean;
  onChange: () => void;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = state === "indeterminate";
    }
  }, [state]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={state === "checked"}
      aria-label={`Select ${label}`}
      disabled={disabled}
      onChange={onChange}
      className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-600 focus:ring-cyan-400 dark:bg-slate-900/60"
    />
  );
}

function TreeRow<T>({
  row,
  active,
  selectedState,
  onToggleExpand,
  onToggleSelection,
  onActivate,
  onKeyDown,
  setItemRef,
}: {
  row: FlattenedNode<T>;
  active: boolean;
  selectedState: "checked" | "indeterminate" | "unchecked";
  onToggleExpand: (id: string) => void;
  onToggleSelection: (node: TreeNode<T>) => void;
  onActivate: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, row: FlattenedNode<T>) => void;
  setItemRef: (id: string, element: HTMLButtonElement | null) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${
        active
          ? "bg-cyan-100/80 text-slate-900 dark:bg-cyan-950/40 dark:text-slate-100"
          : "text-slate-700 dark:text-slate-200"
      }`}
      style={{ paddingLeft: `${row.depth * 18 + 12}px` }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          onClick={() => onToggleExpand(row.node.id)}
          aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.node.label}`}
          className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-white/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-100"
        >
          {row.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ) : (
        <span className="h-6 w-6" aria-hidden="true" />
      )}

      <TreeCheckbox
        label={row.node.label}
        state={selectedState}
        disabled={Boolean(row.node.disabled)}
        onChange={() => onToggleSelection(row.node)}
      />

      <button
        ref={(element) => setItemRef(row.node.id, element)}
        type="button"
        role="treeitem"
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        aria-selected={selectedState === "checked"}
        tabIndex={active ? 0 : -1}
        onFocus={() => onActivate(row.node.id)}
        onClick={() => onActivate(row.node.id)}
        onKeyDown={(event) => onKeyDown(event, row)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1 text-left transition-colors hover:bg-white/60 dark:hover:bg-slate-900/50"
      >
        {row.node.icon ? <span className="shrink-0">{row.node.icon}</span> : null}
        <span className={`truncate text-sm font-medium ${row.matchesSearch ? "text-cyan-700 dark:text-cyan-300" : ""}`}>
          {row.node.label}
        </span>
      </button>
    </div>
  );
}

export default function TreeView<T>({
  nodes,
  defaultExpandedIds,
  defaultSelectedIds,
  onSelectionChange,
  className,
}: TreeViewProps<T>) {
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState(() => new Set(defaultExpandedIds ?? []));
  const [selectedIds, setSelectedIds] = useState(() => new Set(defaultSelectedIds ?? []));
  const filteredNodes = useMemo(() => filterTree(nodes, query), [nodes, query]);
  const autoExpandedIds = useMemo(() => collectExpandedIds(filteredNodes), [filteredNodes]);
  const effectiveExpandedIds = useMemo(() => {
    if (!query.trim()) {
      return expandedIds;
    }

    return new Set([...expandedIds, ...autoExpandedIds]);
  }, [autoExpandedIds, expandedIds, query]);
  const visibleRows = useMemo(
    () => flattenTree(filteredNodes, effectiveExpandedIds, query),
    [effectiveExpandedIds, filteredNodes, query],
  );
  const treeIndex = useMemo(() => buildTreeIndex(nodes), [nodes]);
  const [activeId, setActiveId] = useState<string | null>(() => visibleRows[0]?.node.id ?? null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (activeId) {
      itemRefs.current[activeId]?.focus();
    }
  }, [activeId]);

  const updateSelectedIds = useCallback(
    (nextSelectedIds: Set<string>) => {
      setSelectedIds(nextSelectedIds);
      onSelectionChange?.([...nextSelectedIds]);
    },
    [onSelectionChange],
  );

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextQuery = event.target.value;
      const nextFilteredNodes = filterTree(nodes, nextQuery);
      const nextAutoExpandedIds = collectExpandedIds(nextFilteredNodes);
      const nextExpandedIds = nextQuery.trim()
        ? new Set([...expandedIds, ...nextAutoExpandedIds])
        : expandedIds;
      const nextVisibleRows = flattenTree(nextFilteredNodes, nextExpandedIds, nextQuery);

      setQuery(nextQuery);

      if (!nextVisibleRows.some((row) => row.node.id === activeId)) {
        setActiveId(nextVisibleRows[0]?.node.id ?? null);
      }
    },
    [activeId, expandedIds, nodes],
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }, []);

  const handleToggleSelection = useCallback(
    (node: TreeNode<T>) => {
      if (node.disabled) {
        return;
      }

      const descendantIds = collectDescendantIds(node);
      const nextSelectedIds = new Set(selectedIds);
      const shouldSelect = descendantIds.some((id) => !nextSelectedIds.has(id));

      for (const id of descendantIds) {
        if (shouldSelect) {
          nextSelectedIds.add(id);
        } else {
          nextSelectedIds.delete(id);
        }
      }

      updateSelectedIds(nextSelectedIds);
    },
    [selectedIds, updateSelectedIds],
  );

  const setItemRef = useCallback((id: string, element: HTMLButtonElement | null) => {
    itemRefs.current[id] = element;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, row: FlattenedNode<T>) => {
      const currentIndex = visibleRows.findIndex((candidate) => candidate.node.id === row.node.id);
      const currentMeta = treeIndex[row.node.id];

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextRow = visibleRows[currentIndex + 1];
          if (nextRow) {
            setActiveId(nextRow.node.id);
          }
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const previousRow = visibleRows[currentIndex - 1];
          if (previousRow) {
            setActiveId(previousRow.node.id);
          }
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          if (row.hasChildren && !row.expanded) {
            handleToggleExpand(row.node.id);
          } else {
            const nextRow = visibleRows[currentIndex + 1];
            if (nextRow && nextRow.parentId === row.node.id) {
              setActiveId(nextRow.node.id);
            }
          }
          break;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (row.hasChildren && row.expanded) {
            handleToggleExpand(row.node.id);
          } else if (currentMeta?.parentId) {
            setActiveId(currentMeta.parentId);
          }
          break;
        }
        case " ":
        case "Enter": {
          event.preventDefault();
          handleToggleSelection(row.node);
          break;
        }
        default:
          break;
      }
    },
    [handleToggleExpand, handleToggleSelection, treeIndex, visibleRows],
  );

  const wrapperClassName = [
    "space-y-4 rounded-3xl p-4",
    GLASS_PANEL_CLASS,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={wrapperClassName}>
      <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 dark:bg-slate-900/50">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={handleSearchChange}
          placeholder="Search nodes"
          aria-label="Search tree"
          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
      </div>

      {visibleRows.length ? (
        <div role="tree" aria-label="Data tree" className="space-y-1">
          {visibleRows.map((row) => (
            <TreeRow
              key={row.node.id}
              row={row}
              active={row.node.id === activeId}
              selectedState={getCheckboxState(row.node, selectedIds)}
              onToggleExpand={handleToggleExpand}
              onToggleSelection={handleToggleSelection}
              onActivate={setActiveId}
              onKeyDown={handleKeyDown}
              setItemRef={setItemRef}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No nodes match this search.
        </div>
      )}
    </section>
  );
}
