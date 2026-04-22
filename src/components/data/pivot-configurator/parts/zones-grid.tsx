"use client";

import { Table2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ColumnProfile } from "@/types/dataset";

import type { DropZoneKind, PivotFilter, ValueField } from "../types";
import { DraggableColumn, DropZone, ZonePill } from "./drop-zones";
import { FilterFieldRow } from "./filter-fields";
import { ValueFieldRow } from "./value-fields";

interface ZonesGridProps {
  columns: ColumnProfile[];
  rowFields: string[];
  setRowFields: Dispatch<SetStateAction<string[]>>;
  columnFields: string[];
  setColumnFields: Dispatch<SetStateAction<string[]>>;
  valueFields: ValueField[];
  setValueFields: Dispatch<SetStateAction<ValueField[]>>;
  filters: PivotFilter[];
  setFilters: Dispatch<SetStateAction<PivotFilter[]>>;
  onDropColumn: (columnName: string, kind: DropZoneKind) => void;
}

export function ZonesGrid({
  columns,
  rowFields,
  setRowFields,
  columnFields,
  setColumnFields,
  valueFields,
  setValueFields,
  filters,
  setFilters,
  onDropColumn,
}: ZonesGridProps) {
  return (
    <>
      <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <Table2 className="h-3.5 w-3.5" />
          Available columns
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {columns.map((column) => (
            <DraggableColumn key={column.name} column={column} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DropZone
          title="Rows"
          kind="rows"
          subtitle="Drop dimensions that should define row groups."
          onDropColumn={onDropColumn}
        >
          {rowFields.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No row fields yet.</p>
          ) : (
            rowFields.map((field) => (
              <ZonePill
                key={field}
                label={field}
                onRemove={() =>
                  setRowFields((current) => current.filter((entry) => entry !== field))
                }
              />
            ))
          )}
        </DropZone>

        <DropZone
          title="Columns"
          kind="columns"
          subtitle="Drop dimensions that should form column headers."
          onDropColumn={onDropColumn}
        >
          {columnFields.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No column fields yet.</p>
          ) : (
            columnFields.map((field) => (
              <ZonePill
                key={field}
                label={field}
                onRemove={() =>
                  setColumnFields((current) => current.filter((entry) => entry !== field))
                }
              />
            ))
          )}
        </DropZone>

        <DropZone
          title="Values"
          kind="values"
          subtitle="Drop numeric fields here, then configure multiple aggregations."
          onDropColumn={onDropColumn}
        >
          {valueFields.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No value fields yet.</p>
          ) : (
            valueFields.map((field) => (
              <ValueFieldRow
                key={field.id}
                field={field}
                columns={columns}
                setValueFields={setValueFields}
              />
            ))
          )}
        </DropZone>

        <DropZone
          title="Filters"
          kind="filters"
          subtitle="Drop a field here and set a literal filter value."
          onDropColumn={onDropColumn}
        >
          {filters.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No filters yet.</p>
          ) : (
            filters.map((filterItem) => (
              <FilterFieldRow
                key={filterItem.id}
                filterItem={filterItem}
                columns={columns}
                setFilters={setFilters}
              />
            ))
          )}
        </DropZone>
      </div>
    </>
  );
}
