import { describe, expect, it } from "vitest";
import { mergeSegments, nonMaxSuppression, durationRange } from "../../src/application/highlightScoring";

const segment = (start: number, end: number, score = 0.5) => ({ start, end, score, reason: "" });

describe("highlight scoring", () => {
  it("merges overlapping segments", () => {
    const merged = mergeSegments([segment(0, 10), segment(9, 18)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toBe(0);
    expect(merged[0].end).toBe(18);
  });

  it("applies non max suppression", () => {
    const reduced = nonMaxSuppression([segment(0, 10, 0.9), segment(2, 9, 0.5)]);
    expect(reduced).toHaveLength(1);
    expect(reduced[0].start).toBe(0);
  });

  it("returns duration presets", () => {
    expect(durationRange("short")).toEqual({ min: 12, max: 22 });
    expect(durationRange("normal")).toEqual({ min: 18, max: 32 });
    expect(durationRange("long")).toEqual({ min: 30, max: 45 });
  });
});
