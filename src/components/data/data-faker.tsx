"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, FileDown, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, generateId } from "@/lib/utils/formatters";

interface DataFakerProps {
  onDataGenerated: (csvContent: string, fileName: string) => void;
}

type FakerType = "number" | "text" | "date" | "boolean";
type TemplateId = "sales" | "analytics" | "iot" | "finance" | "employees" | "custom";

interface FakerColumn {
  id: string;
  name: string;
  type: FakerType;
  constraints: string;
}

interface TemplateDefinition {
  id: TemplateId;
  label: string;
  description: string;
  fileBase: string;
  columns: FakerColumn[];
}

const ease = [0.16, 1, 0.3, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/70 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-100";

const makeColumn = (name: string, type: FakerType, constraints = ""): FakerColumn => ({
  id: generateId(),
  name,
  type,
  constraints,
});

const TEMPLATES: TemplateDefinition[] = [
  { id: "sales", label: "Sales Data", description: "Orders, regions, revenue, and fulfillment.", fileBase: "sales-demo", columns: [makeColumn("order_id", "text", "kind=id,prefix=ORD"), makeColumn("region", "text", "choices=North|South|West|East"), makeColumn("sales_rep", "text", "choices=Avery|Jordan|Casey|Taylor|Morgan"), makeColumn("order_date", "date", "start=2023-01-01,end=2024-12-31"), makeColumn("revenue", "number", "min=50,max=12000,decimals=2"), makeColumn("fulfilled", "boolean", "trueRate=0.86")] },
  { id: "analytics", label: "User Analytics", description: "Users, traffic, sessions, and conversion behavior.", fileBase: "user-analytics", columns: [makeColumn("user_id", "text", "kind=id,prefix=USR"), makeColumn("signup_date", "date", "start=2022-01-01,end=2024-12-31"), makeColumn("traffic_source", "text", "choices=Organic|Paid Search|Referral|Email|Direct"), makeColumn("session_count", "number", "min=1,max=120"), makeColumn("conversion_rate", "number", "min=0.5,max=18,decimals=2"), makeColumn("is_active", "boolean", "trueRate=0.72")] },
  { id: "iot", label: "IoT Sensor Data", description: "Time-series style telemetry with health markers.", fileBase: "iot-sensor-demo", columns: [makeColumn("device_id", "text", "kind=id,prefix=DEV"), makeColumn("recorded_at", "date", "start=2024-01-01,end=2024-03-31"), makeColumn("temperature_c", "number", "min=12,max=38,decimals=1"), makeColumn("humidity_pct", "number", "min=20,max=95,decimals=1"), makeColumn("site", "text", "choices=Factory A|Factory B|Warehouse 2"), makeColumn("alarm_state", "boolean", "trueRate=0.09")] },
  { id: "finance", label: "Financial Transactions", description: "Transaction values, accounts, and risk markers.", fileBase: "financial-transactions", columns: [makeColumn("transaction_id", "text", "kind=id,prefix=TX"), makeColumn("account_type", "text", "choices=Checking|Savings|Credit|Brokerage"), makeColumn("merchant", "text", "choices=Atlas|Nova|Harbor|Summit|Lattice"), makeColumn("transaction_date", "date", "start=2023-01-01,end=2024-12-31"), makeColumn("amount", "number", "min=-850,max=4200,decimals=2"), makeColumn("flagged", "boolean", "trueRate=0.04")] },
  { id: "employees", label: "Employee Records", description: "Departments, levels, payroll, and status data.", fileBase: "employee-records", columns: [makeColumn("employee_id", "text", "kind=id,prefix=EMP"), makeColumn("department", "text", "choices=Engineering|Support|Sales|People|Finance"), makeColumn("start_date", "date", "start=2018-01-01,end=2024-12-31"), makeColumn("salary", "number", "min=42000,max=210000"), makeColumn("level", "text", "choices=Associate|Mid|Senior|Lead|Director"), makeColumn("remote", "boolean", "trueRate=0.48")] },
  { id: "custom", label: "Custom", description: "Start from a blank schema and define every column yourself.", fileBase: "custom-dataset", columns: [makeColumn("id", "text", "kind=id,prefix=ROW"), makeColumn("value", "number", "min=1,max=100")] },
] as const;

function parseConstraints(input: string) {
  return input.split(",").reduce<Record<string, string>>((acc, entry) => {
    const [rawKey, ...rest] = entry.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(values: string[]) {
  return values[randomInt(0, values.length - 1)] ?? "";
}

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function generateTextValue(column: FakerColumn, rowIndex: number) {
  const rules = parseConstraints(column.constraints);
  const choices = rules.choices?.split("|").map((item) => item.trim()).filter(Boolean);
  if (choices?.length) return randomChoice(choices);
  if (rules.kind === "email") return `user${rowIndex + 1}@example.com`;
  if (rules.kind === "url") return `https://example.com/item/${rowIndex + 1}`;
  if (rules.kind === "id") return `${rules.prefix ?? "ID"}-${String(rowIndex + 1).padStart(5, "0")}`;
  const words = ["Alpha", "North", "Beacon", "Nova", "Delta", "Orbit", "Lattice", "Cedar"];
  return `${randomChoice(words)} ${column.name.replace(/_/g, " ")}`.trim();
}

function generateNumberValue(column: FakerColumn) {
  const rules = parseConstraints(column.constraints);
  const min = Number(rules.min ?? 0);
  const max = Number(rules.max ?? 1000);
  const decimals = Number(rules.decimals ?? 0);
  const raw = min + Math.random() * (max - min);
  return Number(raw.toFixed(Math.max(0, decimals)));
}

function generateDateValue(column: FakerColumn) {
  const rules = parseConstraints(column.constraints);
  const start = new Date(rules.start ?? "2024-01-01");
  const end = new Date(rules.end ?? "2024-12-31");
  const timestamp = start.getTime() + Math.random() * Math.max(end.getTime() - start.getTime(), 86_400_000);
  return new Date(timestamp).toISOString().slice(0, 10);
}

function generateBooleanValue(column: FakerColumn) {
  const rules = parseConstraints(column.constraints);
  return Math.random() < Number(rules.trueRate ?? 0.5);
}

function generateCell(column: FakerColumn, rowIndex: number) {
  if (column.type === "number") return generateNumberValue(column);
  if (column.type === "date") return generateDateValue(column);
  if (column.type === "boolean") return generateBooleanValue(column);
  return generateTextValue(column, rowIndex);
}

function generateRows(columns: FakerColumn[], count: number) {
  return Array.from({ length: count }, (_, rowIndex) =>
    Object.fromEntries(columns.map((column) => [column.name || `column_${rowIndex + 1}`, generateCell(column, rowIndex)])),
  );
}

function generateCsv(columns: FakerColumn[], count: number) {
  const headers = columns.map((column) => column.name);
  const lines = [headers.map(escapeCsv).join(",")];
  for (let index = 0; index < count; index += 1) {
    const row = columns.map((column) => escapeCsv(generateCell(column, index)));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function StepCard({ step, label, active }: { step: number; label: string; active: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm transition ${active ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" : "border-slate-200/70 bg-white/60 text-slate-500 dark:border-slate-700/70 dark:bg-slate-950/35 dark:text-slate-400"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">Step {step}</p>
      <p className="mt-1 font-semibold">{label}</p>
    </div>
  );
}

export default function DataFaker({ onDataGenerated }: DataFakerProps) {
  const [templateId, setTemplateId] = useState<TemplateId>("sales");
  const [columns, setColumns] = useState<FakerColumn[]>(TEMPLATES[0].columns);
  const [rowCount, setRowCount] = useState(1000);
  const [step, setStep] = useState(1);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewDirty, setPreviewDirty] = useState(true);
  const [generatedCsv, setGeneratedCsv] = useState("");
  const [generatedFileName, setGeneratedFileName] = useState("");
  const [generating, setGenerating] = useState(false);
  const template = useMemo(() => TEMPLATES.find((item) => item.id === templateId) ?? TEMPLATES[0], [templateId]);

  function replaceColumns(nextColumns: FakerColumn[]) {
    setColumns(nextColumns);
    setPreviewDirty(true);
    setGeneratedCsv("");
    setGeneratedFileName("");
  }

  function loadTemplate(nextTemplateId: TemplateId) {
    const nextTemplate = TEMPLATES.find((item) => item.id === nextTemplateId) ?? TEMPLATES[0];
    setTemplateId(nextTemplate.id);
    replaceColumns(nextTemplate.columns.map((column) => ({ ...column, id: generateId() })));
  }

  function updateColumn(id: string, key: keyof FakerColumn, value: string) {
    replaceColumns(columns.map((column) => (column.id === id ? { ...column, [key]: value } : column)));
  }

  function ensurePreview() {
    if (!previewDirty && previewRows.length > 0) return;
    setPreviewRows(generateRows(columns, 10));
    setPreviewDirty(false);
  }

  async function buildDataset() {
    setGenerating(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const csv = generateCsv(columns, rowCount);
    const fileName = `${template.fileBase}-${rowCount}.csv`;
    setGeneratedCsv(csv);
    setGeneratedFileName(fileName);
    setGenerating(false);
    return { csv, fileName };
  }

  async function handleDownload() {
    const payload = generatedCsv ? { csv: generatedCsv, fileName: generatedFileName } : await buildDataset();
    downloadFile(payload.csv, payload.fileName, "text/csv;charset=utf-8;");
  }

  async function handleLoadIntoDataLens() {
    const payload = generatedCsv ? { csv: generatedCsv, fileName: generatedFileName } : await buildDataset();
    onDataGenerated(payload.csv, payload.fileName);
  }

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease }} className={`${panelClass} bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,250,252,0.72))] dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.82))]`}>
      <div className="border-b border-white/30 px-6 py-5 dark:border-white/10">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
          <Sparkles className="h-3.5 w-3.5" />
          Data Faker
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Generate synthetic datasets for demos and tests</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Walk through a four-step wizard, preview the first ten rows, then download the generated CSV or send it straight into DataLens.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <StepCard step={1} label="Template" active={step === 1} />
          <StepCard step={2} label="Columns" active={step === 2} />
          <StepCard step={3} label="Rows" active={step === 3} />
          <StepCard step={4} label="Preview" active={step === 4} />
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        {step === 1 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {TEMPLATES.map((item) => (
              <button key={item.id} type="button" onClick={() => loadTemplate(item.id)} className={`rounded-[24px] border p-5 text-left transition ${templateId === item.id ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" : "border-slate-200/70 bg-white/60 text-slate-700 hover:border-slate-300 dark:border-slate-700/70 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:border-slate-600"}`}>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.description}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{item.columns.length} preset columns</p>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            {columns.map((column) => (
              <div key={column.id} className="grid gap-3 rounded-[24px] border border-slate-200/70 bg-white/60 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-950/35 md:grid-cols-[1.3fr_0.7fr_1.5fr_auto]">
                <input value={column.name} onChange={(event) => updateColumn(column.id, "name", event.target.value)} placeholder="column_name" className={fieldClass} />
                <select value={column.type} onChange={(event) => updateColumn(column.id, "type", event.target.value)} className={fieldClass}>
                  <option value="number">number</option>
                  <option value="text">text</option>
                  <option value="date">date</option>
                  <option value="boolean">boolean</option>
                </select>
                <input value={column.constraints} onChange={(event) => updateColumn(column.id, "constraints", event.target.value)} placeholder="min=0,max=100 or choices=A|B|C" className={fieldClass} />
                <button type="button" onClick={() => replaceColumns(columns.filter((item) => item.id !== column.id))} disabled={columns.length <= 1} className="inline-flex items-center justify-center rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-slate-600 transition hover:text-rose-600 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-300">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => replaceColumns([...columns, makeColumn(`column_${columns.length + 1}`, "text")])} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
              <Plus className="h-4 w-4" />
              Add column
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="rounded-[26px] border border-slate-200/70 bg-white/60 p-6 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-950/35">
            <label className="block space-y-3">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Row count</span>
              <input type="range" min={100} max={100000} step={100} value={rowCount} onChange={(event) => { setRowCount(Number(event.target.value)); setPreviewDirty(true); setGeneratedCsv(""); }} className="w-full accent-cyan-500" />
              <input type="number" min={100} max={100000} step={100} value={rowCount} onChange={(event) => { setRowCount(Number(event.target.value)); setPreviewDirty(true); setGeneratedCsv(""); }} className={fieldClass} />
            </label>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Current target: {formatNumber(rowCount)} rows across {formatNumber(columns.length)} columns.</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={ensurePreview} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-500/15 dark:text-cyan-300">
                <Wand2 className="h-4 w-4" />
                Refresh preview
              </button>
              <button type="button" onClick={() => void buildDataset()} disabled={generating} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-60">
                {generating ? <FileDown className="h-4 w-4 animate-pulse" /> : <Sparkles className="h-4 w-4" />}
                Generate CSV
              </button>
              <button type="button" onClick={() => void handleDownload()} disabled={generating} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
                <Download className="h-4 w-4" />
                Download CSV
              </button>
              <button type="button" onClick={() => void handleLoadIntoDataLens()} disabled={generating} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
                <FileDown className="h-4 w-4" />
                Load into DataLens
              </button>
            </div>
            <div className="overflow-hidden rounded-[26px] border border-slate-200/70 bg-white/60 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-950/35">
              <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Preview rows</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">First 10 generated records from the current schema.</p>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">{generatedFileName || `${template.fileBase}-${rowCount}.csv`}</span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                {previewRows.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Refresh the preview to generate sample rows.</div>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-white/90 backdrop-blur dark:bg-slate-950/90">
                      <tr>
                        {columns.map((column) => (
                          <th key={column.id} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{column.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => (
                        <tr key={`preview-${index}`} className="border-t border-slate-200/60 dark:border-slate-800/70">
                          {columns.map((column) => (
                            <td key={`${index}-${column.id}`} className="px-4 py-3 text-slate-700 dark:text-slate-200">{String(row[column.name] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-white/30 px-6 py-4 dark:border-white/10">
        <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1} className="rounded-2xl border border-slate-300/70 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">Back</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">{formatNumber(columns.length)} columns configured</p>
        <button type="button" onClick={() => { const next = Math.min(4, step + 1); setStep(next); if (next === 4) ensurePreview(); }} disabled={step === 4} className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50">Next</button>
      </div>

      <AnimatePresence>
        {generatedCsv ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="border-t border-emerald-500/20 bg-emerald-500/10 px-6 py-4 text-sm text-emerald-700 dark:text-emerald-300">
            Dataset ready: {generatedFileName} with {formatNumber(rowCount)} rows.
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
