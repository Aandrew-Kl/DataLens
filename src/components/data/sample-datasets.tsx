"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CloudSun,
  Database,
  FileSpreadsheet,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SampleDatasetsProps {
  onLoad: (fileName: string, csvContent: string) => void;
}

interface SampleDatasetCard {
  fileName: string;
  title: string;
  description: string;
  csvContent: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  icon: LucideIcon;
  accent: string;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const SALES_PRODUCTS = [
  {
    product: "Notebook Pro 14",
    category: "Electronics",
    basePrice: 1499,
    baseCost: 1035,
  },
  {
    product: "Insight CRM Suite",
    category: "Software",
    basePrice: 899,
    baseCost: 315,
  },
  {
    product: "Ergo Chair X",
    category: "Furniture",
    basePrice: 429,
    baseCost: 238,
  },
  {
    product: "Warehouse Sensor",
    category: "IoT",
    basePrice: 259,
    baseCost: 148,
  },
  {
    product: "Analytics Plus",
    category: "Software",
    basePrice: 699,
    baseCost: 242,
  },
  {
    product: "Studio Display 27",
    category: "Electronics",
    basePrice: 1199,
    baseCost: 832,
  },
  {
    product: "Support Care Plan",
    category: "Services",
    basePrice: 179,
    baseCost: 74,
  },
  {
    product: "Field Tablet M8",
    category: "Electronics",
    basePrice: 849,
    baseCost: 566,
  },
] as const;

const SALES_REGIONS = [
  "North America",
  "Europe",
  "APAC",
  "Latin America",
  "Middle East",
] as const;

const CUSTOMER_TYPES = [
  "Enterprise",
  "SMB",
  "Consumer",
  "Channel Partner",
] as const;

const SALES_DATA_CSV = [
  "date,product,category,region,units,revenue,cost,profit,customer_type",
  ...Array.from({ length: 100 }, (_, index) => {
    const product = SALES_PRODUCTS[index % SALES_PRODUCTS.length];
    const region = SALES_REGIONS[index % SALES_REGIONS.length];
    const customerType = CUSTOMER_TYPES[index % CUSTOMER_TYPES.length];
    const month = (index % 12) + 1;
    const day = ((index * 3) % 28) + 1;
    const units = 8 + ((index * 7) % 34) + (product.basePrice > 1000 ? 2 : 0);
    const revenue =
      units * product.basePrice +
      (index % 5) * 37.5 +
      (region === "North America" ? 120 : 0) +
      (customerType === "Enterprise" ? 240 : 0);
    const cost =
      units * product.baseCost +
      (index % 4) * 18.25 +
      (region === "APAC" ? 44 : 0);
    const profit = revenue - cost;

    return [
      formatDate(2025, month, day),
      product.product,
      product.category,
      region,
      String(units),
      revenue.toFixed(2),
      cost.toFixed(2),
      profit.toFixed(2),
      customerType,
    ].join(",");
  }),
].join("\n");

const EMPLOYEE_NAMES = [
  ["Ava", "Mitchell"],
  ["Liam", "Brooks"],
  ["Sofia", "Patel"],
  ["Noah", "Kim"],
  ["Mia", "Torres"],
  ["Ethan", "Reed"],
  ["Isla", "Nguyen"],
  ["Lucas", "Price"],
  ["Zoe", "Campbell"],
  ["Mason", "Ward"],
  ["Ella", "Murphy"],
  ["Logan", "Diaz"],
  ["Chloe", "Foster"],
  ["Jack", "Howard"],
  ["Grace", "James"],
  ["Aiden", "Scott"],
  ["Lily", "Parker"],
  ["Henry", "Cook"],
  ["Nora", "Bell"],
  ["Owen", "Flores"],
  ["Aria", "Rogers"],
  ["Leo", "Bailey"],
  ["Hannah", "Rivera"],
  ["James", "Cooper"],
  ["Scarlett", "Morgan"],
] as const;

const EMPLOYEE_DEPARTMENTS = [
  {
    department: "Engineering",
    positions: ["Frontend Engineer", "Backend Engineer", "Data Engineer"],
    salaryBase: 112000,
  },
  {
    department: "Product",
    positions: ["Product Manager", "Product Analyst", "UX Researcher"],
    salaryBase: 101000,
  },
  {
    department: "Sales",
    positions: ["Account Executive", "Sales Manager", "Customer Success Lead"],
    salaryBase: 92000,
  },
  {
    department: "Finance",
    positions: ["Financial Analyst", "Controller", "Revenue Analyst"],
    salaryBase: 98000,
  },
  {
    department: "Operations",
    positions: ["Operations Manager", "Program Manager", "Procurement Lead"],
    salaryBase: 94000,
  },
  {
    department: "Marketing",
    positions: ["Growth Marketer", "Content Strategist", "Brand Manager"],
    salaryBase: 89000,
  },
] as const;

const EMPLOYEE_CITIES = [
  "Austin",
  "Boston",
  "Chicago",
  "Denver",
  "New York",
  "San Diego",
  "Seattle",
  "Toronto",
] as const;

const EMPLOYEE_DATA_CSV = [
  "id,name,department,position,salary,hire_date,performance_score,city",
  ...Array.from({ length: 50 }, (_, index) => {
    const [firstName, lastName] =
      EMPLOYEE_NAMES[index % EMPLOYEE_NAMES.length];
    const department =
      EMPLOYEE_DEPARTMENTS[index % EMPLOYEE_DEPARTMENTS.length];
    const position =
      department.positions[(index + Math.floor(index / 3)) % department.positions.length];
    const city = EMPLOYEE_CITIES[index % EMPLOYEE_CITIES.length];
    const salary =
      department.salaryBase +
      (index % 7) * 4200 +
      (index % 3 === 0 ? 6500 : 0) +
      (city === "New York" ? 9000 : 0);
    const performanceScore = (3.2 + ((index * 11) % 18) / 10).toFixed(1);
    const hireYear = 2018 + (index % 7);
    const hireMonth = ((index * 2) % 12) + 1;
    const hireDay = ((index * 5) % 28) + 1;

    return [
      `EMP-${String(index + 1001)}`,
      `${firstName} ${lastName}`,
      department.department,
      position,
      String(salary),
      formatDate(hireYear, hireMonth, hireDay),
      performanceScore,
      city,
    ].join(",");
  }),
].join("\n");

const WEATHER_CITIES = [
  { city: "Athens", baselineTemp: 24, humidity: 52 },
  { city: "Berlin", baselineTemp: 18, humidity: 63 },
  { city: "Chicago", baselineTemp: 20, humidity: 60 },
  { city: "Dubai", baselineTemp: 34, humidity: 42 },
  { city: "Singapore", baselineTemp: 31, humidity: 80 },
  { city: "Sydney", baselineTemp: 17, humidity: 58 },
] as const;

const WEATHER_DATA_CSV = [
  "date,city,temperature,humidity,wind_speed,precipitation,condition",
  ...Array.from({ length: 60 }, (_, index) => {
    const location = WEATHER_CITIES[index % WEATHER_CITIES.length];
    const day = Math.floor(index / WEATHER_CITIES.length) + 1;
    const temperature =
      location.baselineTemp + ((index * 3) % 9) - 4 + (day % 3 === 0 ? 1.5 : 0);
    const humidity = Math.min(
      92,
      location.humidity + ((index * 7) % 15) - 6 + (day % 4 === 0 ? 4 : 0),
    );
    const windSpeed = 6 + ((index * 5) % 19) + (location.city === "Chicago" ? 4 : 0);
    const precipitation =
      location.city === "Singapore"
        ? ((index * 9) % 14) / 2
        : location.city === "Berlin"
          ? ((index * 7) % 8) / 2
          : ((index * 5) % 6) / 2;

    let condition = "Sunny";
    if (precipitation >= 5) condition = "Thunderstorm";
    else if (precipitation >= 2.5) condition = "Rain";
    else if (humidity >= 75) condition = "Cloudy";
    else if (humidity >= 68) condition = "Partly Cloudy";
    else if (windSpeed >= 22) condition = "Windy";

    return [
      formatDate(2025, 6, day),
      location.city,
      temperature.toFixed(1),
      String(Math.round(humidity)),
      windSpeed.toFixed(1),
      precipitation.toFixed(1),
      condition,
    ].join(",");
  }),
].join("\n");

function buildDataset(
  fileName: string,
  title: string,
  description: string,
  csvContent: string,
  icon: LucideIcon,
  accent: string,
): SampleDatasetCard {
  const [headerLine, ...rows] = csvContent.trim().split("\n");
  const columns = headerLine.split(",");

  return {
    fileName,
    title,
    description,
    csvContent,
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    icon,
    accent,
  };
}

const SAMPLE_DATASETS: SampleDatasetCard[] = [
  buildDataset(
    "sales_data.csv",
    "Revenue performance",
    "Quarterly-style commercial pipeline with regions, product mix, unit volumes, and margin signals.",
    SALES_DATA_CSV,
    Database,
    "from-indigo-500 via-violet-500 to-cyan-500",
  ),
  buildDataset(
    "employee_data.csv",
    "People analytics",
    "Org snapshot with compensation, tenure, performance, and hiring patterns across departments.",
    EMPLOYEE_DATA_CSV,
    Users,
    "from-emerald-500 via-teal-500 to-sky-500",
  ),
  buildDataset(
    "weather_data.csv",
    "Operational weather feed",
    "City-level conditions over time for trend analysis, forecasting demos, and chart prototyping.",
    WEATHER_DATA_CSV,
    CloudSun,
    "from-amber-500 via-orange-500 to-rose-500",
  ),
];

function PreviewColumns({ columns }: { columns: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {columns.map((column) => (
        <span
          key={column}
          className="rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-300"
        >
          {column}
        </span>
      ))}
    </div>
  );
}

export default function SampleDatasets({ onLoad }: SampleDatasetsProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/80 p-6 shadow-[0_20px_70px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/70 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/70 to-transparent" />
      <div className="absolute -right-24 top-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-400/10" />
      <div className="absolute -left-24 bottom-0 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl dark:bg-cyan-400/10" />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3 py-1 text-xs font-semibold text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            Try with sample data
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Load a realistic dataset in one click
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Explore profiling, dashboards, AI queries, and SQL without
            preparing a file first. Each sample is embedded locally and loads
            instantly.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/75 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-950/50 dark:text-slate-300">
          <FileSpreadsheet className="h-4 w-4 text-indigo-500 dark:text-indigo-300" />
          Built-in CSV examples
        </div>
      </div>

      <div className="relative mt-8 grid gap-4 lg:grid-cols-3">
        {SAMPLE_DATASETS.map((dataset, index) => {
          const Icon = dataset.icon;
          const isSelected = selectedFile === dataset.fileName;

          return (
            <motion.button
              key={dataset.fileName}
              type="button"
              onClick={() => {
                setSelectedFile(dataset.fileName);
                onLoad(dataset.fileName, dataset.csvContent);
              }}
              className="group relative flex h-full flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/85 p-5 text-left shadow-[0_18px_50px_-36px_rgba(15,23,42,0.65)] transition-colors hover:border-indigo-300/80 hover:bg-white dark:border-slate-700/70 dark:bg-slate-950/55 dark:hover:border-indigo-400/40 dark:hover:bg-slate-950/75"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: index * 0.08 }}
              whileHover={{ y: -4, scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div
                className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${dataset.accent}`}
              />
              <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/60 blur-2xl dark:bg-white/5" />

              <div className="relative flex items-start justify-between gap-4">
                <div
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${dataset.accent} text-white shadow-lg shadow-slate-900/10`}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <span className="rounded-full border border-slate-200/80 bg-slate-50/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-400">
                  CSV
                </span>
              </div>

              <div className="relative mt-5">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                    {dataset.title}
                  </h3>
                  {isSelected && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                      Loaded
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {dataset.fileName}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {dataset.description}
                </p>
              </div>

              <div className="relative mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/70">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    Rows
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {dataset.rowCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/70">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    Columns
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {dataset.columnCount}
                  </p>
                </div>
              </div>

              <div className="relative mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  Included fields
                </p>
                <PreviewColumns columns={dataset.columns} />
              </div>

              <div className="relative mt-6 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/75 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/75">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Load instantly
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No upload or network request required
                  </p>
                </div>
                <motion.div
                  animate={{ x: isSelected ? 4 : 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="rounded-full border border-slate-200/80 bg-white/80 p-2 text-slate-700 shadow-sm dark:border-slate-700/70 dark:bg-slate-950/80 dark:text-slate-200"
                >
                  <ArrowRight className="h-4 w-4" />
                </motion.div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
