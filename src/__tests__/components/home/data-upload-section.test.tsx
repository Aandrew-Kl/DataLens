import { fireEvent, render, screen } from "@testing-library/react";

import DataUploadSection from "@/components/home/DataUploadSection";

const mockFileDropResult = {
  fileName: "sales.csv",
  csvContent: "region,revenue\nEast,100",
  sizeBytes: 128,
};

jest.mock("framer-motion");
jest.mock("@/components/data/file-dropzone", () => ({
  __esModule: true,
  default: ({
    onFileLoaded,
  }: {
    onFileLoaded: (result: typeof mockFileDropResult) => void;
  }) => (
    <button type="button" onClick={() => onFileLoaded(mockFileDropResult)}>
      Mock file dropzone
    </button>
  ),
}));

describe("DataUploadSection", () => {
  it("renders the file dropzone by default", () => {
    render(
      <DataUploadSection
        isLoading={false}
        loadError={null}
        onFileLoaded={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Mock file dropzone" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Loading and profiling data..."),
    ).not.toBeInTheDocument();
  });

  it("forwards the onFileLoaded callback to FileDropzone", () => {
    const onFileLoaded = jest.fn();

    render(
      <DataUploadSection
        isLoading={false}
        loadError={null}
        onFileLoaded={onFileLoaded}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mock file dropzone" }));

    expect(onFileLoaded).toHaveBeenCalledWith(mockFileDropResult);
  });

  it("shows the loading status when profiling is in progress", () => {
    render(
      <DataUploadSection
        isLoading
        loadError={null}
        onFileLoaded={jest.fn()}
      />,
    );

    expect(screen.getByText("Loading and profiling data...")).toBeInTheDocument();
  });

  it("shows the upload error message when loading fails", () => {
    render(
      <DataUploadSection
        isLoading={false}
        loadError="Could not parse the uploaded file."
        onFileLoaded={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Could not parse the uploaded file."),
    ).toBeInTheDocument();
  });
});
