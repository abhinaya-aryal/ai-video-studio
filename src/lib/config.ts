import os from "node:os";
import path from "node:path";
import { z } from "zod";

export type QwenKeyType = "token_plan" | "standard";
export type QwenRegion = "ap-southeast-1" | "cn-beijing";
export type TextProvider = "qwen" | "openai_compat";

export interface AppConfig {
  dataDir: string;
  projectsDir: string;
  qwen: {
    apiKey?: string;
    keyType: QwenKeyType;
    region: QwenRegion;
    workspaceId?: string;
    baseUrlOverride?: string;
  };
  textProvider: TextProvider;
  openaiCompat?: {
    baseUrl: string;
    apiKey?: string;
    model: string;
  };
  jobs: {
    maxConcurrent: number;
    pollIntervalMs: number;
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Expand a leading `~` to the current user's home directory. */
function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

const EnvSchema = z
  .object({
    DATA_DIR: z.string().default("data"),
    PROJECTS_DIR: z.string().default("~/projects"),
    QWEN_API_KEY: z.string().optional(),
    QWEN_KEY_TYPE: z.enum(["auto", "token_plan", "standard"]).default("auto"),
    QWEN_REGION: z
      .enum(["ap-southeast-1", "cn-beijing"])
      .default("ap-southeast-1"),
    QWEN_WORKSPACE_ID: z.string().optional(),
    QWEN_BASE_URL: z.string().url().optional(),
    TEXT_PROVIDER: z.enum(["qwen", "openai_compat"]).default("qwen"),
    OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
    OPENAI_COMPAT_API_KEY: z.string().optional(),
    OPENAI_COMPAT_MODEL: z.string().min(1).optional(),
    MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(16).default(3),
    JOB_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(10000),
  })
  .superRefine((env, ctx) => {
    if (env.TEXT_PROVIDER === "openai_compat") {
      if (!env.OPENAI_COMPAT_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_COMPAT_BASE_URL"],
          message:
            "OPENAI_COMPAT_BASE_URL is required when TEXT_PROVIDER=openai_compat",
        });
      }
      if (!env.OPENAI_COMPAT_MODEL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_COMPAT_MODEL"],
          message:
            "OPENAI_COMPAT_MODEL is required when TEXT_PROVIDER=openai_compat",
        });
      }
    }
  });

function resolveQwenKeyType(
  configured: "auto" | QwenKeyType,
  apiKey?: string,
): QwenKeyType {
  if (configured !== "auto") return configured;
  return apiKey?.startsWith("sk-sp-") ? "token_plan" : "standard";
}

/** Lazily read and validate environment configuration. */
export function getConfig(): AppConfig {
  const parsed = EnvSchema.parse({
    DATA_DIR: emptyToUndefined(process.env.DATA_DIR),
    PROJECTS_DIR: emptyToUndefined(process.env.PROJECTS_DIR),
    QWEN_API_KEY: emptyToUndefined(process.env.QWEN_API_KEY),
    QWEN_KEY_TYPE: emptyToUndefined(process.env.QWEN_KEY_TYPE),
    QWEN_REGION: emptyToUndefined(process.env.QWEN_REGION),
    QWEN_WORKSPACE_ID: emptyToUndefined(process.env.QWEN_WORKSPACE_ID),
    QWEN_BASE_URL: emptyToUndefined(process.env.QWEN_BASE_URL),
    TEXT_PROVIDER: emptyToUndefined(process.env.TEXT_PROVIDER),
    OPENAI_COMPAT_BASE_URL: emptyToUndefined(
      process.env.OPENAI_COMPAT_BASE_URL,
    ),
    OPENAI_COMPAT_API_KEY: emptyToUndefined(process.env.OPENAI_COMPAT_API_KEY),
    OPENAI_COMPAT_MODEL: emptyToUndefined(process.env.OPENAI_COMPAT_MODEL),
    MAX_CONCURRENT_JOBS: emptyToUndefined(process.env.MAX_CONCURRENT_JOBS),
    JOB_POLL_INTERVAL_MS: emptyToUndefined(process.env.JOB_POLL_INTERVAL_MS),
  });

  const cwd = process.cwd();
  const openaiCompat =
    parsed.OPENAI_COMPAT_BASE_URL && parsed.OPENAI_COMPAT_MODEL
      ? {
          baseUrl: parsed.OPENAI_COMPAT_BASE_URL,
          apiKey: parsed.OPENAI_COMPAT_API_KEY,
          model: parsed.OPENAI_COMPAT_MODEL,
        }
      : undefined;

  return {
    dataDir: path.resolve(cwd, expandHome(parsed.DATA_DIR)),
    projectsDir: path.resolve(cwd, expandHome(parsed.PROJECTS_DIR)),
    qwen: {
      apiKey: parsed.QWEN_API_KEY,
      keyType: resolveQwenKeyType(parsed.QWEN_KEY_TYPE, parsed.QWEN_API_KEY),
      region: parsed.QWEN_REGION,
      workspaceId: parsed.QWEN_WORKSPACE_ID,
      baseUrlOverride: parsed.QWEN_BASE_URL,
    },
    textProvider: parsed.TEXT_PROVIDER,
    openaiCompat,
    jobs: {
      maxConcurrent: parsed.MAX_CONCURRENT_JOBS,
      pollIntervalMs: parsed.JOB_POLL_INTERVAL_MS,
    },
  };
}

/** Mask an API key for display in logs and API status responses. */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "****";

  const tail = trimmed.slice(-4);
  if (trimmed.startsWith("sk-sp-")) {
    return `sk-sp-****${tail}`;
  }
  if (trimmed.startsWith("sk-")) {
    return `sk-****${tail}`;
  }
  return `****${tail}`;
}
