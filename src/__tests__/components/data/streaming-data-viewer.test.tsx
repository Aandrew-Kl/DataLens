import { render, screen } from "@testing-library/react";
import type { UseStreamingQueryState } from "@/hooks/use-streaming-query";
import StreamingDataViewer from "@/components/data/streaming-data-viewer";
import { useStreamingQuery } from "@/hooks/use-streaming-query";

jest.mock("framer-motion");

jest.mock("@/hooks/use-streaming-query", () => ({
  useStreamingQuery: jest.fn(),
}));

const mockUseStreamingQuery = jest.mocked(useStreamingQuery);

function buildHookState(
  overrides: Partial<UseStreamingQueryState> = {},
): UseStreamingQueryState {
  return {
    rows: [],
    isStreaming: false,
    progress: null,
    error: null,
    isConnected: true,
    execute: jest.fn(),
    ...overrides,
  };
}

describe("StreamingDataViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseStreamingQuery.mockReturnValue(buildHookState());
  });

  it("renders the connection indicator", () => {
    render(<StreamingDataViewer datasetId="dataset-1" />);

    expect(mockUseStreamingQuery).toHaveBeenCalledWith(
      "ws://localhost:8000/ws/data-stream",
      "dataset-1",
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByLabelText("WebSocket connected")).toBeInTheDocument();
  });

  it("renders the query input and stream button", () => {
    render(<StreamingDataViewer datasetId="dataset-1" />);

    const input = screen.getByLabelText("SQL query");
    const button = screen.getByRole("button", { name: "Stream" });

    expect(input).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it("shows a progress bar while streaming", () => {
    mockUseStreamingQuery.mockReturnValue(
      buildHookState({
        isStreaming: true,
        rows: [{ id: 1 }, { id: 2 }],
        progress: {
          percent: 42,
          label: "Receiving rows",
        },
      }),
    );

    render(<StreamingDataViewer datasetId="dataset-1" />);

    expect(screen.getByRole("progressbar", { name: "Streaming progress" })).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("2 rows streamed")).toBeInTheDocument();
  });

  it("renders a data table with streamed rows", () => {
    mockUseStreamingQuery.mockReturnValue(
      buildHookState({
        rows: [
          { id: 1, name: "Alpha" },
          { id: 2, name: "Beta" },
        ],
      }),
    );

    render(<StreamingDataViewer datasetId="dataset-1" />);

    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows an error message", () => {
    mockUseStreamingQuery.mockReturnValue(
      buildHookState({
        error: "Stream failed",
      }),
    );

    render(<StreamingDataViewer datasetId="dataset-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Stream failed");
  });

  it("shows the empty state", () => {
    render(<StreamingDataViewer datasetId="dataset-1" />);

    expect(screen.getByText("No results yet")).toBeInTheDocument();
    expect(
      screen.getByText("Submit a SQL query to start streaming dataset rows."),
    ).toBeInTheDocument();
  });
});
