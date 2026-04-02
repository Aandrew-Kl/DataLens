import { act, fireEvent, render, screen } from "@testing-library/react";

import FileDropzone from "@/components/data/file-dropzone";

jest.mock("framer-motion");

describe("FileDropzone", () => {
  it("renders the idle state and updates the drag prompt", () => {
    const { container } = render(<FileDropzone onFileLoaded={jest.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const dropzone = input.parentElement as HTMLElement;

    expect(screen.getByText("Drop your data here")).toBeInTheDocument();

    fireEvent.dragOver(dropzone);
    expect(screen.getByText("Release to upload")).toBeInTheDocument();
  });

  it("shows an error for unsupported files and lets the user reset", () => {
    const { container } = render(<FileDropzone onFileLoaded={jest.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(
      screen.getByText(/Unsupported file type: \.txt/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(screen.getByText("Drop your data here")).toBeInTheDocument();
  });

  it("converts json input to CSV and calls onFileLoaded after the success delay", async () => {
    jest.useFakeTimers();
    const onFileLoaded = jest.fn();
    const { container } = render(<FileDropzone onFileLoaded={onFileLoaded} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      ['[{"id":1,"meta":{"city":"Athens"}},{"id":2,"meta":{"city":"Berlin"}}]'],
      "cities.json",
      { type: "application/json" },
    );
    Object.defineProperty(file, "text", {
      configurable: true,
      value: jest
        .fn()
        .mockResolvedValue(
          '[{"id":1,"meta":{"city":"Athens"}},{"id":2,"meta":{"city":"Berlin"}}]',
        ),
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText("Loaded successfully!"),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onFileLoaded).toHaveBeenCalledWith({
      fileName: "cities.json",
      csvContent: "id,meta_city\n1,Athens\n2,Berlin",
      sizeBytes: file.size,
    });

    jest.useRealTimers();
  });
});
