import { z } from "zod";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { parseProviderErrorResponse } from "@/lib/providers/errors";
import {
  PROVIDER_PRESET_IDS,
  readCredentialsFile,
  readSettingsFile,
} from "@/lib/settings/store";

const FetchProviderModelsSchema = z.object({
  baseUrl: z.string().trim().url("Enter a valid Base URL first"),
  apiKey: z.string().optional(),
  providerId: z.string().trim().min(1).optional(),
  preset: z.enum(PROVIDER_PRESET_IDS).optional(),
});

/**
 * Fetch live model IDs from any OpenAI-compatible provider's `/models` endpoint,
 * using either the API key entered in the form or the saved key for `providerId`.
 */
export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, FetchProviderModelsSchema);
    const cfg = getConfig();

    let apiKey = input.apiKey?.trim() || undefined;
    let preset = input.preset;
    if (!apiKey && input.providerId) {
      const creds = readCredentialsFile(cfg.dataDir);
      apiKey = creds[input.providerId]?.trim() || undefined;
      if (!preset) {
        const stored = readSettingsFile(cfg.dataDir);
        preset = stored.providers.find((p) => p.id === input.providerId)?.preset;
      }
    }

    const cleanBase = input.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${cleanBase}/models`, {
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

    if (rawIds.length === 0) {
      throw new RouteError(
        "EMPTY_MODELS",
        "The provider returned no models from /models.",
        502,
      );
    }

    const isGemini =
      preset === "gemini" ||
      cleanBase.includes("generativelanguage.googleapis.com");

    const models = Array.from(
      new Set(
        rawIds.map((m) =>
          isGemini && m.startsWith("models/") ? m.slice("models/".length) : m,
        ),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return apiOk({ models });
  } catch (err) {
    return handleRouteError(err);
  }
}
