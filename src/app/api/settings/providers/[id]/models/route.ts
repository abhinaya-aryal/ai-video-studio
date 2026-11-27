import {
  RouteError,
  apiOk,
  handleRouteError,
} from "@/lib/api/route-helpers";
import { getConfig, resolveQwenKeyType } from "@/lib/config";
import { parseProviderErrorResponse } from "@/lib/providers/errors";
import { listGeminiModels } from "@/lib/providers/gemini-client";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";
import {
  readCredentialsFile,
  readSettingsFile,
} from "@/lib/settings/store";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fetch live model IDs from a configured provider's `/models` endpoint so the
 * UI can offer a model picker for Gemini, Groq, OpenRouter, OpenAI, or Qwen.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const cfg = getConfig();
    const stored = readSettingsFile(cfg.dataDir);
    const provider = stored.providers.find((p) => p.id === id);
    if (!provider) {
      throw new RouteError("NOT_FOUND", "Provider not found.", 404);
    }

    const creds = readCredentialsFile(cfg.dataDir);
    const apiKey = creds[provider.id]?.trim();

    if (provider.kind === "gemini") {
      const items = await listGeminiModels({
        apiKey: apiKey ?? "",
        baseUrl: provider.baseUrl,
      });
      return apiOk({ models: items.map((m) => m.modelId), items });
    }

    let baseUrl: string;
    if (provider.kind === "qwen") {
      if (!apiKey) {
        throw new RouteError(
          "API_KEY_MISSING",
          `API key for "${provider.name}" is not configured.`,
          400,
        );
      }
      baseUrl = `${resolveQwenBaseUrl({
        keyType: resolveQwenKeyType(provider.keyType ?? "auto", apiKey),
        region: provider.region ?? "ap-southeast-1",
        baseUrlOverride: provider.baseUrl,
      })}/compatible-mode/v1`;
    } else {
      const clean = provider.baseUrl?.trim().replace(/\/+$/, "");
      if (!clean) {
        throw new RouteError(
          "VALIDATION_ERROR",
          `Provider "${provider.name}" has no Base URL.`,
          400,
        );
      }
      baseUrl = clean;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw await parseProviderErrorResponse(res);
    }

    const json = (await res.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const rawIds = Array.isArray(json.data)
      ? json.data
          .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
          .filter(Boolean)
      : [];

    // Gemini's OpenAI-compat /models returns IDs like "models/gemini-2.5-flash";
    // strip the leading "models/" prefix so it matches chat/completions model IDs.
    const models = Array.from(
      new Set(
        rawIds.map((m) =>
          provider.preset === "gemini" && m.startsWith("models/")
            ? m.slice("models/".length)
            : m,
        ),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return apiOk({ models });
  } catch (err) {
    return handleRouteError(err);
  }
}
