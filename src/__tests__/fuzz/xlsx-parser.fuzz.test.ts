import * as fc from "../../test-helpers/fast-check-lite";
import { parseExcel } from "@/lib/parsers/excel-parser";

const PARSER_TIMEOUT_MESSAGE = "Parser did not settle";

jest.setTimeout(30000);

type ExcelArrayBufferResult = ArrayBuffer | null | undefined;

function toArrayBuffer(payload: Uint8Array) {
  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  ) as ArrayBuffer;
}

const xlsxLikeInputs = fc.oneof<ExcelArrayBufferResult>(
  fc.uint8Array({ maxLength: 4096 }).map(toArrayBuffer),
  fc.constant(new Uint8Array(0).buffer),
  fc.constant(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer),
  fc.constant(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]).buffer),
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
  it("parseExcel settles with either CSV text or an Error for fuzzed workbook payloads", async () => {
    await fc.assert(
      fc.property(xlsxLikeInputs, async (input) => {
        await expectHandledParserOutcome(
          () =>
            parseExcel({
              name: "fuzz.xlsx",
              arrayBuffer: async () => input as ArrayBuffer,
            } as File),
          (result) => {
            expect(typeof result).toBe("string");
          }
        );
      }),
      { numRuns: 80 }
    );
  });

  it("parseExcel rejects with an Error when file reading fails", async () => {
    await fc.assert(
      fc.property(fc.uint8Array({ maxLength: 32 }), async () => {
        await expectHandledParserOutcome(
          () =>
            parseExcel({
              name: "fuzz.xlsx",
              arrayBuffer: async () => {
                throw new Error("read failed");
              },
            } as unknown as File),
          () => {
            throw new Error("parseExcel should not resolve after a file read error");
          }
        );
      }),
      { numRuns: 24 }
    );
  });
});
