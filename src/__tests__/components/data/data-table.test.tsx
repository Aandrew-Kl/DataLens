import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataTable from "@/components/data/data-table";

jest.mock("framer-motion");

const tableData = [
  { id: 1, name: "Beta", active: true, created: "2025-01-02", score: 20 },
  { id: 2, name: "Alpha", active: false, created: "2025-01-01", score: 10 },
  { id: 3, name: "Gamma", active: true, created: null, score: null },
];

const columnTypes = {
  id: "number",
  name: "string",
  active: "boolean",
  created: "date",
  score: "number",
} as const;

describe("DataTable", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders an empty state when there is no data", () => {
    render(<DataTable data={[]} columns={["id", "name"]} />);

    expect(screen.getByText("No data to display")).toBeInTheDocument();
    expect(
      screen.getByText("Load a dataset to see results here"),
    ).toBeInTheDocument();
  });

  it("filters rows after the debounced search, paginates, and forwards row clicks", async () => {
    jest.useFakeTimers();
    const onRowClick = jest.fn();

    render(
      <DataTable
        data={tableData}
        columns={["id", "name", "active", "created", "score"]}
        columnTypes={columnTypes}
        pageSize={2}
        title="Orders"
        onRowClick={onRowClick}
      />,
    );

    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–2 of 3 rows")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "beta" },
    });

    await act(async () => {
      jest.advanceTimersByTime(350);
    });

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) =>
          element?.textContent === "Found 1 matching row",
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Beta").closest("tr") as HTMLElement);
    expect(onRowClick).toHaveBeenCalledWith(tableData[0], 0);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "10" },
    });
    expect(screen.getByText("Showing 1–1 of 1 rows")).toBeInTheDocument();

  });

  it("copies individual cells, copies all rows, and exports CSV", async () => {
    const user = userEvent.setup();
    const writeTextSpy = jest
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <DataTable
        data={tableData}
        columns={["id", "name", "active", "created", "score"]}
        columnTypes={columnTypes}
        title="Orders"
      />,
    );

    await user.click(screen.getByText("Alpha"));
    expect(writeTextSpy).toHaveBeenCalledWith("Alpha");
    expect(await screen.findByText("Copied!")).toBeInTheDocument();

    await user.click(screen.getByTitle("Copy all (tab-separated)"));
    expect(writeTextSpy).toHaveBeenLastCalledWith(
      "id\tname\tactive\tcreated\tscore\n1\tBeta\ttrue\t2025-01-02\t20\n2\tAlpha\tfalse\t2025-01-01\t10\n3\tGamma\ttrue\t\t",
    );

    await user.click(screen.getByTitle("Export CSV"));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    writeTextSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
