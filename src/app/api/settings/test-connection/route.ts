import { z } from "zod";
import { apiOk, handleRouteError } from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { testOpenAIConnection } from "@/lib/providers/openai-text";
import { testQwenConnection } from "@/lib/providers/qwen-client";

const TestConnectionSchema = z
  .object({
    target: z.enum(["qwen", "openai_compat", "all"]).default("all"),
  })
  .default({ target: "all" });

export async function POST(req: Request) {
  try {
    let target: "qwen" | "openai_compat" | "all" = "all";
    try {
      const raw = await req.json();
      const parsed = TestConnectionSchema.safeParse(raw);
      if (parsed.success) {
        target = parsed.data.target;
      }
    } catch {
      // Empty or non-JSON body defaults to testing all configured providers.
    }

    let cfg;
    try {
      cfg = getConfig();
    } catch (err) {
      return apiOk({
        ok: false,
        qwen: {
          ok: false,
          detail:
            err instanceof Error
              ? err.message
              : "Invalid environment configuration.",
        },
      });
    }

    const qwenResult =
      target === "qwen" || target === "all"
        ? await testQwenConnection(cfg)
        : undefined;

    const openaiResult =
      (target === "openai_compat" ||
        (target === "all" && cfg.textProvider === "openai_compat")) &&
      cfg.openaiCompat
        ? await testOpenAIConnection(cfg.openaiCompat)
        : target === "openai_compat"
          ? {
              ok: false,
              detail:
                "OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_MODEL are not configured in .env.local.",
            }
          : undefined;

    const checks = [qwenResult, openaiResult].filter(
      (r): r is { ok: boolean; detail: string } => r !== undefined,
    );
    const ok = checks.length > 0 && checks.every((r) => r.ok);

    return apiOk({
      ok,
      ...(qwenResult ? { qwen: qwenResult } : {}),
      ...(openaiResult ? { openaiCompat: openaiResult } : {}),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
