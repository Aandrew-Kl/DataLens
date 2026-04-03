import { useStreamingQuery } from "@/hooks/use-streaming-query";

describe("useStreamingQuery", () => {
  it("is defined", () => {
    expect(typeof useStreamingQuery).toBe("function");
  });
});
