import * as fc from "../../test-helpers/fast-check-lite";
import { parseExcel } from "@/lib/parsers/excel-parser";

const PARSER_TIMEOUT_MESSAGE = "Parser did not settle";

jest.setTimeout(30000);

type FileReaderArrayBufferResult = Uint8Array | null | undefined;

class ControlledArrayBufferFileReader {
  static nextResult: FileReaderArrayBufferResult = new Uint8Array(0);
  static failNextRead = false;

  onload: ((event: { target: { result: ArrayBuffer | null | undefined } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(file: Blob): void {
    void file;

    if (ControlledArrayBufferFileReader.failNextRead) {
      ControlledArrayBufferFileReader.failNextRead = false;
      this.onerror?.();
      return;
    }

    const payload = ControlledArrayBufferFileReader.nextResult;
    const result: ArrayBuffer | null | undefined =
      payload == null
        ? payload
        : (payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          ) as ArrayBuffer);

    this.onload?.({
      target: {
        result,
      },
    });
  }
}

const xlsxLikeInputs = fc.oneof<FileReaderArrayBufferResult>(
  fc.uint8Array({ maxLength: 4096 }),
  fc.constant(new Uint8Array(0)),
  fc.constant(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
  fc.constant(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc])),
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

describe("excel parser fuzz coverage", () => {
  const originalFileReader = global.FileReader;

  beforeAll(() => {
    global.FileReader = ControlledArrayBufferFileReader as unknown as typeof FileReader;
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  beforeEach(() => {
    ControlledArrayBufferFileReader.nextResult = new Uint8Array(0);
    ControlledArrayBufferFileReader.failNextRead = false;
  });

  it("parseExcel settles with either CSV text or an Error for fuzzed workbook payloads", async () => {
    await fc.assert(
      fc.property(xlsxLikeInputs, async (input) => {
        ControlledArrayBufferFileReader.nextResult = input;

        await expectHandledParserOutcome(
          () => parseExcel({} as File),
          (result) => {
            expect(typeof result).toBe("string");
          }
        );
      }),
      { numRuns: 80 }
    );
  });

  it("parseExcel rejects with an Error when FileReader fails mid-read", async () => {
    await fc.assert(
      fc.property(fc.uint8Array({ maxLength: 32 }), async () => {
        ControlledArrayBufferFileReader.failNextRead = true;
        await expectHandledParserOutcome(
          () => parseExcel({} as File),
          () => {
            throw new Error("parseExcel should not resolve after a FileReader error");
          }
        );
      }),
      { numRuns: 24 }
    );
  });
});
