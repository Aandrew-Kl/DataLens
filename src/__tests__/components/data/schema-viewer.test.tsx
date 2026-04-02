import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchemaViewer from "@/components/data/schema-viewer";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const createObjectUrlMock = jest.fn(() => "blob:mock-schema");
const revokeObjectUrlMock = jest.fn();

const schemaColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 5,
    uniqueCount: 40,
    sampleValues: [10, 15, 20],
    min: 5,
    max: 40,
    mean: 20,
    median: 18,
  },
  {
    name: "city",
    type: "string",
    nullCount: 1,
    uniqueCount: 4,
    sampleValues: ["Athens", "Berlin", "Paris"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: ["2024-01-01", "2024-01-02"],
    min: "2024-01-01",
    max: "2024-12-31",
  },
];

describe("SchemaViewer", () => {
  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: revokeObjectUrlMock,
    });
  });

  beforeEach(() => {
    mockRunQuery.mockReset();
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
  });

  it("renders schema details, filters rows, expands numeric stats, and exports JSON", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockRunQuery.mockResolvedValue([{ sd: 2.3456 }]);

    render(
      <SchemaViewer tableName="orders" columns={schemaColumns} rowCount={100} />,
    );

    expect(screen.getByText("Schema Summary")).toBeInTheDocument();
    expect(screen.getByText("Columns")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Filter columns..."), "sale");

    expect(screen.getByText("Showing 1 of 3 columns")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
    expect(screen.queryByText("city")).not.toBeInTheDocument();

    await user.click(screen.getByText("sales"));

    expect(await screen.findByText("Numeric Stats")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('STDDEV_SAMP("sales")'),
    );
    expect(screen.getByText("2.35")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /export json/i }));

    expect(createObjectUrlMock).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("renders an empty state when there are no columns", () => {
    render(<SchemaViewer tableName="orders" columns={[]} rowCount={0} />);

    expect(screen.getByText("No schema information available")).toBeInTheDocument();
  });
});
