"use client";

import { motion } from "framer-motion";
import { Database, Download, LayoutGrid } from "lucide-react";
import { startTransition, useMemo, useState } from "react";

import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

import { aggregatePivotRows, renderPivotCsv } from "./compute";
import {
  buildPivotSql,
  defaultValueField,
  readSavedConfigs,
  sanitizeAlias,
  writeSavedConfigs,
} from "./lib";
import { CalculatedFieldsPanel } from "./parts/calculated-fields";
import { ConditionalRulesPanel } from "./parts/conditional-rules";
import { NoticeBanner } from "./parts/drop-zones";
import { PivotTable } from "./parts/pivot-table";
import { SavedConfigsPanel } from "./parts/saved-configs";
import { ZonesGrid } from "./parts/zones-grid";
import {
  EASE,
  PANEL_CLASS,
  type CalculatedField,
  type ConditionalOperator,
  type ConditionalRule,
  type DropZoneKind,
  type NoticeState,
  type PivotFilter,
  type PivotResult,
  type SavedPivotConfig,
  type ValueField,
} from "./types";

interface PivotConfiguratorProps {
  tableName: string;
  columns: ColumnProfile[];
}

function PivotConfiguratorInner({ tableName, columns }: PivotConfiguratorProps) {
  const [rowFields, setRowFields] = useState<string[]>([]);
  const [columnFields, setColumnFields] = useState<string[]>([]);
  const [valueFields, setValueFields] = useState<ValueField[]>(
    columns[0]?.name ? [defaultValueField(columns[0].name)] : [],
  );
  const [filters, setFilters] = useState<PivotFilter[]>([]);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>([]);
  const [conditionalRules, setConditionalRules] = useState<ConditionalRule[]>([]);
  const [calcName, setCalcName] = useState("");
  const [calcFormula, setCalcFormula] = useState("");
  const [ruleMeasure, setRuleMeasure] = useState("__all__");
  const [ruleOperator, setRuleOperator] = useState<ConditionalOperator>("gt");
  const [ruleValue, setRuleValue] = useState("");
  const [ruleSecondValue, setRuleSecondValue] = useState("");
  const [ruleColor, setRuleColor] = useState("#06b6d4");
  const [showSubtotals, setShowSubtotals] = useState(true);
  const [showGrandTotals, setShowGrandTotals] = useState(true);
  const [result, setResult] = useState<PivotResult | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<SavedPivotConfig[]>(() =>
    readSavedConfigs(tableName),
  );
  const [configName, setConfigName] = useState("");

  const availableMeasures = useMemo(
    () => [
      ...valueFields.map((field) => field.alias),
      ...calculatedFields.map((field) => sanitizeAlias(field.name)),
    ],
    [calculatedFields, valueFields],
  );

  const displayColumns = useMemo(() => {
    if (!result) return [];
    return result.colKeys.flatMap((colKey) =>
      result.measures.map((measure) => ({ colKey, measure })),
    );
  }, [result]);

  const groupedRows = useMemo(() => {
    if (!result) return [] as Array<{ group: string; rows: string[] }>;
    const groups = new Map<string, string[]>();
    for (const rowKey of result.rowKeys) {
      const label = result.rowLabels.get(rowKey)?.[0] ?? rowKey;
      const bucket = groups.get(label) ?? [];
      bucket.push(rowKey);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries()).map(([group, rows]) => ({ group, rows }));
  }, [result]);

  function applyConfig(config: SavedPivotConfig) {
    startTransition(() => {
      setRowFields(config.rowFields);
      setColumnFields(config.columnFields);
      setValueFields(config.valueFields);
      setFilters(config.filters);
      setCalculatedFields(config.calculatedFields);
      setConditionalRules(config.conditionalRules);
      setShowSubtotals(config.showSubtotals);
      setShowGrandTotals(config.showGrandTotals);
      setResult(null);
      setCollapsedGroups([]);
    });
    setNotice({ tone: "success", message: `Loaded "${config.name}".` });
  }

  function persistConfigs(nextConfigs: SavedPivotConfig[]) {
    setSavedConfigs(nextConfigs);
    writeSavedConfigs(tableName, nextConfigs);
  }

  function handleDropColumn(columnName: string, kind: DropZoneKind) {
    if (!columns.some((column) => column.name === columnName)) return;

    startTransition(() => {
      if (kind === "rows") {
        setRowFields((current) =>
          current.includes(columnName) ? current : [...current, columnName],
        );
      } else if (kind === "columns") {
        setColumnFields((current) =>
          current.includes(columnName) ? current : [...current, columnName],
        );
      } else if (kind === "values") {
        setValueFields((current) =>
          current.some((field) => field.column === columnName)
            ? current
            : [...current, defaultValueField(columnName)],
        );
      } else {
        setFilters((current) =>
          current.some((filter) => filter.column === columnName)
            ? current
            : [
                ...current,
                {
                  id: generateId(),
                  column: columnName,
                  operator: "equals",
                  value: "",
                },
              ],
        );
      }
    });
  }

  function addCalculatedField() {
    const name = sanitizeAlias(calcName);
    if (!name || !calcFormula.trim()) {
      setNotice({ tone: "error", message: "Calculated fields require both a name and a formula." });
      return;
    }

    setCalculatedFields((current) => [
      ...current,
      {
        id: generateId(),
        name,
        formula: calcFormula.trim(),
      },
    ]);
    setCalcName("");
    setCalcFormula("");
    setNotice({ tone: "success", message: `Added calculated field "${name}".` });
  }

  function addConditionalRule() {
    if (ruleValue.trim() === "") {
      setNotice({ tone: "error", message: "Conditional formatting needs at least one threshold value." });
      return;
    }

    if (ruleOperator === "between" && ruleSecondValue.trim() === "") {
      setNotice({ tone: "error", message: "Between rules need both lower and upper bounds." });
      return;
    }

    setConditionalRules((current) => [
      ...current,
      {
        id: generateId(),
        measure: ruleMeasure,
        operator: ruleOperator,
        value: ruleValue,
        secondValue: ruleSecondValue,
        color: ruleColor,
      },
    ]);
    setRuleValue("");
    setRuleSecondValue("");
  }

  async function runPivot() {
    if (rowFields.length === 0 && columnFields.length === 0) {
      setNotice({ tone: "error", message: "Drag at least one field into rows or columns." });
      return;
    }
    if (valueFields.length === 0) {
      setNotice({ tone: "error", message: "Add at least one value field." });
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const sql = buildPivotSql(
        tableName,
        rowFields,
        columnFields,
        valueFields,
        filters,
        calculatedFields,
      );
      const rows = await runQuery(sql);
      const aggregated = aggregatePivotRows(
        rows,
        rowFields,
        columnFields,
        valueFields,
        calculatedFields,
      );

      setCollapsedGroups([]);
      setResult(aggregated);
      setNotice({
        tone: "success",
        message: `Pivot returned ${rows.length} grouped row${rows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setResult(null);
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Pivot query failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  function saveCurrentConfig() {
    const name = configName.trim();
    if (!name) {
      setNotice({ tone: "error", message: "Name the configuration before saving it." });
      return;
    }

    const nextConfig: SavedPivotConfig = {
      id: generateId(),
      name,
      rowFields,
      columnFields,
      valueFields,
      filters,
      calculatedFields,
      conditionalRules,
      showSubtotals,
      showGrandTotals,
    };

    const nextConfigs = [nextConfig, ...savedConfigs].slice(0, 12);
    persistConfigs(nextConfigs);
    setConfigName("");
    setNotice({ tone: "success", message: `Saved "${name}" to localStorage.` });
  }

  function deleteConfig(configId: string) {
    const nextConfigs = savedConfigs.filter((config) => config.id !== configId);
    persistConfigs(nextConfigs);
  }

  function exportPivotCsv() {
    if (!result) {
      setNotice({ tone: "error", message: "Run the pivot before exporting it." });
      return;
    }

    const csv = renderPivotCsv({
      result,
      rowFields,
      displayColumns,
      groupedRows,
      collapsedGroups,
      showSubtotals,
      showGrandTotals,
    });

    downloadFile(csv, `${tableName}-pivot-configured.csv`, "text/csv;charset=utf-8");
    setNotice({ tone: "success", message: "Exported pivot as CSV." });
  }

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <LayoutGrid className="h-3.5 w-3.5" />
              Advanced pivot configurator
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Drag fields into rows, columns, values, and filters
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Combine multiple aggregations, saved layouts, calculated measures, row-group
              expansion, conditional formatting, and CSV export in one DuckDB-driven panel.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runPivot()}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              <Database className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Running pivot" : "Run pivot"}
            </button>
            <button
              type="button"
              onClick={exportPivotCsv}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <NoticeBanner notice={notice} />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: EASE }}
          className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]"
        >
          <div className="space-y-5">
            <ZonesGrid
              columns={columns}
              rowFields={rowFields}
              setRowFields={setRowFields}
              columnFields={columnFields}
              setColumnFields={setColumnFields}
              valueFields={valueFields}
              setValueFields={setValueFields}
              filters={filters}
              setFilters={setFilters}
              onDropColumn={handleDropColumn}
            />

            <CalculatedFieldsPanel
              calcName={calcName}
              setCalcName={setCalcName}
              calcFormula={calcFormula}
              setCalcFormula={setCalcFormula}
              calculatedFields={calculatedFields}
              setCalculatedFields={setCalculatedFields}
              onAdd={addCalculatedField}
            />

            <ConditionalRulesPanel
              availableMeasures={availableMeasures}
              ruleMeasure={ruleMeasure}
              setRuleMeasure={setRuleMeasure}
              ruleOperator={ruleOperator}
              setRuleOperator={setRuleOperator}
              ruleValue={ruleValue}
              setRuleValue={setRuleValue}
              ruleSecondValue={ruleSecondValue}
              setRuleSecondValue={setRuleSecondValue}
              ruleColor={ruleColor}
              setRuleColor={setRuleColor}
              conditionalRules={conditionalRules}
              setConditionalRules={setConditionalRules}
              onAdd={addConditionalRule}
            />

            <SavedConfigsPanel
              configName={configName}
              setConfigName={setConfigName}
              savedConfigs={savedConfigs}
              showSubtotals={showSubtotals}
              setShowSubtotals={setShowSubtotals}
              showGrandTotals={showGrandTotals}
              setShowGrandTotals={setShowGrandTotals}
              onSave={saveCurrentConfig}
              onApply={applyConfig}
              onDelete={deleteConfig}
            />
          </div>

          <div className="space-y-5">
            <div className="rounded-[1.6rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
              <PivotTable
                result={result}
                rowFields={rowFields}
                displayColumns={displayColumns}
                groupedRows={groupedRows}
                collapsedGroups={collapsedGroups}
                setCollapsedGroups={setCollapsedGroups}
                showSubtotals={showSubtotals}
                showGrandTotals={showGrandTotals}
                conditionalRules={conditionalRules}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default function PivotConfigurator({
  tableName,
  columns,
}: PivotConfiguratorProps) {
  return <PivotConfiguratorInner key={tableName} tableName={tableName} columns={columns} />;
}
