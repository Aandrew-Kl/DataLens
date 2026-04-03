import { parseProgressUpdate } from "@/lib/api/websocket";

describe("parseProgressUpdate", () => {
  it("returns null for non-object input", () => {
    expect(parseProgressUpdate(null)).toBeNull();
    expect(parseProgressUpdate("not an object")).toBeNull();
    expect(parseProgressUpdate(0.7)).toBeNull();
  });

  it("parses {type:'progress', percent:50} into a progress update", () => {
    expect(parseProgressUpdate({ type: "progress", percent: 50 })).toMatchObject({
      percent: 50,
    });
  });

  it("normalizes 0-1 range percents to 0-100", () => {
    expect(parseProgressUpdate({ type: "progress", percent: 0.5 })).toMatchObject({
      percent: 50,
    });
  });

  it("clamps values above 100", () => {
    expect(parseProgressUpdate({ type: "progress", percent: 175 })).toMatchObject({
      percent: 100,
    });
  });

  it("extracts label and stage fields", () => {
    expect(
      parseProgressUpdate({
        type: "progress",
        percent: 80,
        label: "Loading",
        stage: "fetching",
      }),
    ).toMatchObject({
      percent: 80,
      label: "Loading",
      stage: "fetching",
    });
  });

  it("returns null when no percent or progress field is present", () => {
    expect(parseProgressUpdate({ type: "progress" })).toBeNull();
  });
});
