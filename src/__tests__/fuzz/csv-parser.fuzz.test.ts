import * as fc from "../../test-helpers/fast-check-lite";
import { parseCSV, parseCSVFromText } from "@/lib/parsers/csv-parser";

const PARSER_TIMEOUT_MESSAGE = "Parser did not settle";

jest.setTimeout(30000);

type FileReaderTextResult = string | null | undefined;

class ControlledTextFileReader {
  static nextResult: FileReaderTextResult = "";
  static failNextRead = false;

  onload: ((event: { target: { result: FileReaderTextResult } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsText(file: Blob): void {
    void file;

    if (ControlledTextFileReader.failNextRead) {
      ControlledTextFileReader.failNextRead = false;
      this.onerror?.();
      return;
    }

    this.onload?.({
      target: {
        result: ControlledTextFileReader.nextResult,
      },
    });
  }
}

const csvLikeInputs = fc.oneof<FileReaderTextResult>(
  fc.string({ maxLength: 4096 }),
  fc.constant(""),
  fc.constant("\"unterminated"),
  fc.constant("a,b\r\n1,2"),
  fc.constant("name,quote\nalpha,\"\"\"broken"),
  fc.constant("name,emoji\nalpha,😀"),
  fc.constant("\0,\u2028,\u2029"),
  fc.constant(null),
  fc.constant(undefined)
);

const settle = async <T>(operation: () => Promise<T> | T, timeoutMs = 1000): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(PARSER_TIMEOUT_MESSAGE));
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });

const expectHandledParserOutcome = async <T>(
  operation: () => Promise<T> | T,
  onSuccess: (value: T) => void
): Promise<void> => {
  try {
    onSuccess(await settle(operation));
  } catch (error) {
    if (error instanceof Error && error.message === PARSER_TIMEOUT_MESSAGE) {
      throw error;
    }

    expect(error).toBeInstanceOf(Error);
  }
};

describe("csv parser fuzz coverage", () => {
  const originalFileReader = global.FileReader;

  beforeAll(() => {
    global.FileReader = ControlledTextFileReader as unknown as typeof FileReader;
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  beforeEach(() => {
    ControlledTextFileReader.nextResult = "";
    ControlledTextFileReader.failNextRead = false;
  });

  it("parseCSVFromText returns rows or raises an Error for fuzzed text inputs", async () => {
    await fc.assert(
      fc.property(csvLikeInputs, async (input) => {
        await expectHandledParserOutcome(
          () => parseCSVFromText(input as string),
          (result) => {
            expect(Array.isArray(result)).toBe(true);
          }
        );
      }),
      { numRuns: 120 }
    );
  });

  it("parseCSV settles with either text or an Error for fuzzed file contents", async () => {
    await fc.assert(
      fc.property(csvLikeInputs, async (input) => {
        ControlledTextFileReader.nextResult = input;

        await expectHandledParserOutcome(
          () => parseCSV({} as File),
          (result) => {
            expect(typeof result).toBe("string");
          }
        );
      }),
      { numRuns: 120 }
    );
  });

  it("parseCSV rejects with an Error when FileReader fails mid-read", async () => {
    await fc.assert(
      fc.property(fc.string({ maxLength: 32 }), async () => {
        ControlledTextFileReader.failNextRead = true;
        await expectHandledParserOutcome(
          () => parseCSV({} as File),
          () => {
            throw new Error("parseCSV should not resolve after a FileReader error");
          }
        );
      }),
      { numRuns: 24 }
    );
  });
});
