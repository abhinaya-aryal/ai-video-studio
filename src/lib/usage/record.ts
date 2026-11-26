import { randomUUID } from "node:crypto";
import type { DrizzleDb } from "@/db";
import { usageEvents, type UsageModality } from "@/db/schema";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageRecordInput {
  jobId?: string | null;
  projectId?: string | null;
  modality: UsageModality;
  modelId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  units?: number | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read an OpenAI-compatible `usage` block. Returns null when absent or malformed. */
export function extractChatUsage(json: unknown): TokenUsage | null {
  if (!json || typeof json !== "object") return null;
  const raw = (json as { usage?: unknown }).usage;
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  const inputTokens = finiteNumber(usage.prompt_tokens);
  const outputTokens = finiteNumber(usage.completion_tokens);
  const totalTokens = finiteNumber(usage.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Persist a usage event. Best effort: a failure here never fails the job that
 * produced the usage.
 */
export function recordUsage(db: DrizzleDb, input: UsageRecordInput): void {
  try {
    db.insert(usageEvents)
      .values({
        id: randomUUID(),
        jobId: input.jobId ?? null,
        projectId: input.projectId ?? null,
        modality: input.modality,
        modelId: input.modelId,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        units: input.units ?? null,
        createdAt: Date.now(),
      })
      .run();
  } catch {
    // Usage tracking is observational; never break generation.
  }
}