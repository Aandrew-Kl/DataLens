import { parseJSON } from "../../../lib/parsers/json-parser";

class MockFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;
  static result = JSON.stringify([{ a: 1 }]);

  readAsText(_file: File): void {
    if (this.onload) {
      this.onload({
        target: { result: MockFileReader.result },
      });
    }
  }
}

beforeAll(() => {
  (globalThis as unknown as { FileReader: typeof MockFileReader }).FileReader =
    MockFileReader;
});

describe("parseJSON", () => {
  beforeEach(() => {
    MockFileReader.result = JSON.stringify([{ a: 1 }]);
  });

  it("resolves with stringified array when input is array", async () => {
    MockFileReader.result = JSON.stringify([{ a: 1 }]);
    const file = new File(["content"], "test.json", { type: "application/json" });

    await expect(parseJSON(file)).resolves.toBe('[{"a":1}]');
  });

  it("wraps single object into array", async () => {
    MockFileReader.result = JSON.stringify({ a: 1 });
    const file = new File(["content"], "test.json", { type: "application/json" });

    await expect(parseJSON(file)).resolves.toBe('[{"a":1}]');
  });

  it("rejects on invalid JSON", async () => {
    MockFileReader.result = "not json{";
    const file = new File(["content"], "test.json", { type: "application/json" });

    await expect(parseJSON(file)).rejects.toThrow("Invalid JSON:");
  });
});
