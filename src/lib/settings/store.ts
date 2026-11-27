import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PROVIDER_KINDS = ["qwen", "gemini", "openai_compat"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_PRESET_IDS = [
  "qwen",
  "gemini",
  "groq",
  "openrouter",
  "openai",
  "custom",
] as const;
export type ProviderPresetId = (typeof PROVIDER_PRESET_IDS)[number];

export const TEXT_ROLES = ["text_refine", "text_polish"] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

export const ROLE_PROVIDER_SLOTS = [
  "text_refine",
  "text_polish",
  "image",
  "video",
  "audio",
] as const;
export type RoleProviderSlot = (typeof ROLE_PROVIDER_SLOTS)[number];

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  kind: ProviderKind;
  baseUrl?: string;
  defaultModel?: string;
  description: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "qwen",
    label: "QwenCloud / DashScope",
    kind: "qwen",
    description:
      "Video, image, voiceover (TTS), and text models via DashScope or Token Plan.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "gemini",
    description:
      "Official Google AI Studio / Gemini API via @google/genai SDK (supports AQ. auth keys and AIza keys).",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai_compat",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    description: "Fast inference via Groq's OpenAI-compatible API.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai_compat",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.5-flash",
    description: "Unified OpenAI-compatible router across many text models.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai_compat",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    description: "OpenAI chat completion models.",
  },
  {
    id: "custom",
    label: "Custom OpenAI-Compatible",
    kind: "openai_compat",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "",
    description: "Any OpenAI-compatible server (Ollama, LM Studio, vLLM).",
  },
] as const;

export const StoredProviderSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(PROVIDER_KINDS),
  preset: z.enum(PROVIDER_PRESET_IDS).optional(),
  keyType: z.enum(["auto", "token_plan", "standard"]).optional(),
  region: z.enum(["ap-southeast-1", "cn-beijing"]).optional(),
  workspaceId: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  defaultModel: z.string().trim().optional(),
  enabled: z.boolean().default(true),
});

export type StoredProvider = z.infer<typeof StoredProviderSchema>;

export const RoleProviderBindingSchema = z.object({
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().optional(),
});

export type RoleProviderBinding = z.infer<typeof RoleProviderBindingSchema>;

export const StoredAppSettingsSchema = z.object({
  projectsDir: z.string().trim().min(1).optional(),
  maxConcurrentJobs: z.number().int().min(1).max(16).optional(),
  jobPollIntervalMs: z.number().int().min(1000).max(120000).optional(),
});

export type StoredAppSettings = z.infer<typeof StoredAppSettingsSchema>;

export const StoredSettingsSchema = z.object({
  version: z.literal(1).default(1),
  app: StoredAppSettingsSchema.default({}),
  providers: z.array(StoredProviderSchema).default([]),
  roleProviders: z
    .object({
      text_refine: RoleProviderBindingSchema.optional(),
      text_polish: RoleProviderBindingSchema.optional(),
      image: RoleProviderBindingSchema.optional(),
      video: RoleProviderBindingSchema.optional(),
      audio: RoleProviderBindingSchema.optional(),
    })
    .default({}),
});

export type StoredSettings = z.infer<typeof StoredSettingsSchema>;

const CredentialsFileSchema = z.object({
  version: z.literal(1).default(1),
  keys: z.record(z.string(), z.string()).default({}),
});

export function settingsFilePath(dataDir: string): string {
  return path.join(dataDir, "settings.json");
}

export function credentialsFilePath(dataDir: string): string {
  return path.join(dataDir, "credentials.json");
}

function emptySettings(): StoredSettings {
  return {
    version: 1,
    app: {},
    providers: [],
    roleProviders: {},
  };
}

const LEGACY_GEMINI_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

function normalizeStoredSettings(data: StoredSettings): StoredSettings {
  // Auto-upgrade legacy Gemini providers saved as openai_compat to native `gemini` SDK kind.
  const providers = data.providers.map((p) => {
    if (p.preset === "gemini" && p.kind === "openai_compat") {
      const cleanUrl = p.baseUrl?.trim().replace(/\/+$/, "");
      return {
        ...p,
        kind: "gemini" as const,
        ...(cleanUrl === LEGACY_GEMINI_OPENAI_URL
          ? { baseUrl: undefined }
          : {}),
      };
    }
    return p;
  });

  // Keep text_refine and text_polish bindings consistent if one was saved without modelId.
  const rp = { ...data.roleProviders };
  if (rp.text_polish && !rp.text_polish.modelId && rp.text_refine?.modelId) {
    rp.text_polish = { ...rp.text_refine };
  } else if (rp.text_refine && !rp.text_refine.modelId && rp.text_polish?.modelId) {
    rp.text_refine = { ...rp.text_polish };
  }

  return { ...data, providers, roleProviders: rp };
}

/** Read non-secret UI settings from `${DATA_DIR}/settings.json`. */
export function readSettingsFile(dataDir: string): StoredSettings {
  const filePath = settingsFilePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return emptySettings();
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = StoredSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? normalizeStoredSettings(parsed.data)
      : emptySettings();
  } catch {
    return emptySettings();
  }
}

/** Atomically write non-secret UI settings to `${DATA_DIR}/settings.json`. */
export function writeSettingsFile(
  dataDir: string,
  settings: StoredSettings,
): StoredSettings {
  const validated = StoredSettingsSchema.parse(settings);
  fs.mkdirSync(dataDir, { recursive: true });
  const target = settingsFilePath(dataDir);
  const tmp = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, target);
  return validated;
}

/**
 * Read provider API keys from `${DATA_DIR}/credentials.json`.
 * Never stored in SQLite and never exposed unmasked to the browser.
 */
export function readCredentialsFile(dataDir: string): Record<string, string> {
  const filePath = credentialsFilePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = CredentialsFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.keys : {};
  } catch {
    return {};
  }
}

function writeCredentialsFile(
  dataDir: string,
  keys: Record<string, string>,
): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = credentialsFilePath(dataDir);
  const tmp = `${target}.${randomUUID()}.tmp`;
  const payload = JSON.stringify({ version: 1, keys }, null, 2) + "\n";
  fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // Ignore chmod errors on platforms/filesystems that do not support POSIX modes.
  }
  fs.renameSync(tmp, target);
}

/** Save or remove an API key for a single provider in `credentials.json` (`0600`). */
export function setProviderApiKey(
  dataDir: string,
  providerId: string,
  apiKey: string | null,
): void {
  const keys = readCredentialsFile(dataDir);
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    delete keys[providerId];
  } else {
    keys[providerId] = trimmed;
  }
  writeCredentialsFile(dataDir, keys);
}

export interface CreateProviderInput {
  id?: string;
  name: string;
  kind: ProviderKind;
  preset?: ProviderPresetId;
  keyType?: "auto" | "token_plan" | "standard";
  region?: "ap-southeast-1" | "cn-beijing";
  workspaceId?: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled?: boolean;
  apiKey?: string;
}

/** Add a new provider to `settings.json` and store its API key in `credentials.json`. */
export function createProvider(
  dataDir: string,
  input: CreateProviderInput,
): StoredProvider {
  const settings = readSettingsFile(dataDir);
  const id = input.id?.trim() || `${input.preset ?? input.kind}-${randomUUID().slice(0, 8)}`;

  const provider: StoredProvider = StoredProviderSchema.parse({
    id,
    name: input.name.trim(),
    kind: input.kind,
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.kind === "qwen"
      ? {
          keyType: input.keyType ?? "auto",
          region: input.region ?? "ap-southeast-1",
          ...(input.workspaceId?.trim()
            ? { workspaceId: input.workspaceId.trim() }
            : {}),
        }
      : {}),
    ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
    ...(input.defaultModel?.trim()
      ? { defaultModel: input.defaultModel.trim() }
      : {}),
    enabled: input.enabled ?? true,
  });

  const next: StoredSettings = {
    ...settings,
    providers: [...settings.providers.filter((p) => p.id !== id), provider],
  };
  writeSettingsFile(dataDir, next);

  if (input.apiKey?.trim()) {
    setProviderApiKey(dataDir, provider.id, input.apiKey.trim());
  }

  return provider;
}

export interface UpdateProviderInput {
  name?: string;
  preset?: ProviderPresetId;
  keyType?: "auto" | "token_plan" | "standard";
  region?: "ap-southeast-1" | "cn-beijing";
  workspaceId?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  enabled?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
}

/** Update an existing provider in `settings.json` and optionally rotate/clear its API key. */
export function updateProvider(
  dataDir: string,
  providerId: string,
  patch: UpdateProviderInput,
): StoredProvider | null {
  const settings = readSettingsFile(dataDir);
  const idx = settings.providers.findIndex((p) => p.id === providerId);
  if (idx === -1) return null;

  const existing = settings.providers[idx];
  const updated: StoredProvider = StoredProviderSchema.parse({
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.preset !== undefined ? { preset: patch.preset } : {}),
    ...(patch.keyType !== undefined ? { keyType: patch.keyType } : {}),
    ...(patch.region !== undefined ? { region: patch.region } : {}),
    ...(patch.workspaceId !== undefined
      ? { workspaceId: patch.workspaceId?.trim() || undefined }
      : {}),
    ...(patch.baseUrl !== undefined
      ? { baseUrl: patch.baseUrl?.trim() || undefined }
      : {}),
    ...(patch.defaultModel !== undefined
      ? { defaultModel: patch.defaultModel?.trim() || undefined }
      : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  });

  const providers = [...settings.providers];
  providers[idx] = updated;
  writeSettingsFile(dataDir, { ...settings, providers });

  if (patch.clearApiKey) {
    setProviderApiKey(dataDir, providerId, null);
  } else if (patch.apiKey?.trim()) {
    setProviderApiKey(dataDir, providerId, patch.apiKey.trim());
  }

  return updated;
}

/** Remove a provider, delete its API key, and clear any role bindings referencing it. */
export function deleteProvider(dataDir: string, providerId: string): boolean {
  const settings = readSettingsFile(dataDir);
  const before = settings.providers.length;
  const providers = settings.providers.filter((p) => p.id !== providerId);
  if (providers.length === before) return false;

  const roleProviders = { ...settings.roleProviders };
  for (const slot of ROLE_PROVIDER_SLOTS) {
    if (roleProviders[slot]?.providerId === providerId) {
      delete roleProviders[slot];
    }
  }

  writeSettingsFile(dataDir, { ...settings, providers, roleProviders });
  setProviderApiKey(dataDir, providerId, null);
  return true;
}

export interface UpdateAppAndRolesInput {
  app?: {
    projectsDir?: string | null;
    maxConcurrentJobs?: number | null;
    jobPollIntervalMs?: number | null;
  };
  roleProviders?: {
    text_refine?: RoleProviderBinding | null;
    text_polish?: RoleProviderBinding | null;
    image?: RoleProviderBinding | null;
    video?: RoleProviderBinding | null;
    audio?: RoleProviderBinding | null;
  };
}

/** Update runtime app settings and/or per-role provider bindings. */
export function updateAppAndRoleSettings(
  dataDir: string,
  patch: UpdateAppAndRolesInput,
): StoredSettings {
  const settings = readSettingsFile(dataDir);
  const nextApp: StoredAppSettings = { ...settings.app };
  if (patch.app) {
    if (patch.app.projectsDir !== undefined) {
      const val = patch.app.projectsDir?.trim();
      if (val) nextApp.projectsDir = val;
      else delete nextApp.projectsDir;
    }
    if (patch.app.maxConcurrentJobs !== undefined) {
      if (patch.app.maxConcurrentJobs === null) delete nextApp.maxConcurrentJobs;
      else nextApp.maxConcurrentJobs = patch.app.maxConcurrentJobs;
    }
    if (patch.app.jobPollIntervalMs !== undefined) {
      if (patch.app.jobPollIntervalMs === null) delete nextApp.jobPollIntervalMs;
      else nextApp.jobPollIntervalMs = patch.app.jobPollIntervalMs;
    }
  }

  const nextRoles = { ...settings.roleProviders };
  if (patch.roleProviders) {
    for (const role of ROLE_PROVIDER_SLOTS) {
      if (patch.roleProviders[role] !== undefined) {
        const val = patch.roleProviders[role];
        if (val === null) {
          delete nextRoles[role];
        } else {
          nextRoles[role] = RoleProviderBindingSchema.parse({
            providerId: val.providerId,
            ...(val.modelId?.trim() ? { modelId: val.modelId.trim() } : {}),
          });
        }
      }
    }
  }

  return writeSettingsFile(dataDir, {
    ...settings,
    app: nextApp,
    roleProviders: nextRoles,
  });
}
