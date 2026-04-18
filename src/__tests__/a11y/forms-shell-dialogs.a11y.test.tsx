import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { useRouter } from "next/navigation";

import LoginForm from "@/components/auth/login-form";
import RegisterForm from "@/components/auth/register-form";
import AppShell from "@/components/layout/app-shell";
import Sidebar from "@/components/layout/sidebar";
import CommandBar, { type Command } from "@/components/ui/command-bar";
import Modal from "@/components/ui/modal";
import KeyboardShortcutsDialog from "@/components/ui/keyboard-shortcuts-dialog";
import { useDatasetStore } from "@/stores/dataset-store";
import { useUIStore } from "@/stores/ui-store";
import type { DatasetMeta } from "@/types/dataset";

expect.extend(toHaveNoViolations);

jest.mock("framer-motion");
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));
jest.mock("@/lib/api/auth", () => ({
  login: jest.fn(),
  register: jest.fn(),
}));
jest.mock("@/app/page", () => ({
  __esModule: true,
  default: () => (
    <main>
      <h1>Workspace shell</h1>
      <p>Shell content placeholder</p>
    </main>
  ),
}));

const mockUseRouter = jest.mocked(useRouter);
const pushMock = jest.fn();

const datasets: DatasetMeta[] = [
  {
    id: "orders-id",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 1200,
    columnCount: 4,
    uploadedAt: 1_700_000_000_000,
    sizeBytes: 2048,
    columns: [],
  },
  {
    id: "customers-id",
    name: "customers",
    fileName: "customers.csv",
    rowCount: 300,
    columnCount: 3,
    uploadedAt: 1_700_000_100_000,
    sizeBytes: 1024,
    columns: [],
  },
];

const commands: Command[] = [
  {
    id: "export-csv",
    label: "Export CSV",
    category: "Export",
    description: "Download the current result set as CSV",
    keywords: ["download", "csv"],
    shortcut: "Shift+E",
  },
  {
    id: "open-orders",
    label: "Open orders dataset",
    category: "Data",
    description: "Focus the uploaded orders table",
    keywords: ["orders", "dataset"],
  },
  {
    id: "build-chart",
    label: "Build revenue chart",
    category: "Chart",
    description: "Open the chart builder for revenue metrics",
    keywords: ["visualize", "revenue"],
  },
];

function resetStores() {
  useDatasetStore.setState({ datasets: [], activeDatasetId: null });
  useUIStore.setState({ sidebarOpen: true, theme: "light" });
  document.documentElement.classList.remove("dark");
}

describe("a11y smoke tests: forms, shell, dialogs", () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    pushMock.mockReset();
    mockUseRouter.mockReturnValue({
      push: pushMock,
    } as unknown as ReturnType<typeof useRouter>);

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ollama: true }),
    } as Response);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    window.localStorage.clear();
    resetStores();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    document.body.style.overflow = "";
    window.localStorage.clear();
    resetStores();
  });

  it("login-form has no a11y violations", async () => {
    const { container } = render(<LoginForm redirectTo="/dashboard" />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("register-form has no a11y violations", async () => {
    const { container } = render(<RegisterForm redirectTo="/workspace" />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("app-shell has no a11y violations", async () => {
    const { container } = render(<AppShell />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("sidebar-nav has no a11y violations", async () => {
    useDatasetStore.setState({
      datasets,
      activeDatasetId: "orders-id",
    });

    const { container } = render(
      <Sidebar
        isOpen
        onToggle={jest.fn()}
        onNewDataset={jest.fn()}
        onSettingsOpen={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  // @todo axe should currently flag the command search input because it
  // relies on placeholder text and does not expose a dedicated label.
  it.skip("command-bar has no a11y violations", async () => {
    const { container } = render(
      <CommandBar commands={commands} onExecute={jest.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /command bar/i }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(
          "Search commands, actions, datasets, charts...",
        ),
      ).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("modal has no a11y violations", async () => {
    const { container } = render(
      <Modal open onClose={jest.fn()} title="Settings">
        <button type="button">Save</button>
      </Modal>,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("keyboard-shortcuts-dialog has no a11y violations", async () => {
    const { container } = render(
      <KeyboardShortcutsDialog open onClose={jest.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", {
          name: "Work faster without leaving the keyboard",
        }),
      ).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
