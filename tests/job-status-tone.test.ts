import { describe, expect, it } from "vitest";
import { JOB_STATUSES } from "@/db/schema";
import { jobStatusTone } from "@/lib/ui/status";

describe("jobStatusTone", () => {
  it("maps every job status", () => {
    for (const status of JOB_STATUSES) {
      expect(jobStatusTone(status)).toBeTruthy();
    }
  });

  it("uses semantic tones", () => {
    expect(jobStatusTone("QUEUED")).toBe("neutral");
    expect(jobStatusTone("PENDING")).toBe("info");
    expect(jobStatusTone("RUNNING")).toBe("info");
    expect(jobStatusTone("DOWNLOADING")).toBe("info");
    expect(jobStatusTone("READY")).toBe("success");
    expect(jobStatusTone("FAILED")).toBe("destructive");
  });
});
