import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatEta } from "./format";

describe("format helpers", () => {
  it("formats video durations", () => {
    expect(formatDuration(94)).toBe("1:34");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(null)).toBe("时长未知");
  });

  it("formats progress values", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatEta(125)).toBe("2 分 5 秒");
  });
});

