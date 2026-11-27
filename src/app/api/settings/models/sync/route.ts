import { apiOk, handleRouteError } from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { syncProviderModels } from "@/lib/providers/model-sync";
import { syncAllExternalProviderModels } from "@/lib/settings/provider-models";

export async function POST() {
  try {
    const cfg = getConfig();
    const warnings: string[] = [];

    let added = 0;
    let updated = 0;
    let unavailable = 0;
    let qwenTotal = 0;
    let lastSyncedAt = Date.now();

    const hasExternal = (cfg.providers ?? []).some(
      (p) => (p.kind === "gemini" || p.kind === "openai_compat") && p.enabled,
    );

    if (cfg.qwen.apiKey) {
      try {
        const qwenRes = await syncProviderModels();
        added = qwenRes.added;
        updated = qwenRes.updated;
        unavailable = qwenRes.unavailable;
        qwenTotal = qwenRes.total;
        lastSyncedAt = qwenRes.lastSyncedAt;
      } catch (err) {
        if (!hasExternal) throw err;
        warnings.push(
          `QwenCloud: ${err instanceof Error ? err.message : "sync failed"}`,
        );
      }
    } else if (!hasExternal) {
      // Preserve standard error when no provider is configured at all.
      const res = await syncProviderModels();
      return apiOk(res);
    }

    const extRes = await syncAllExternalProviderModels(cfg.dataDir);
    warnings.push(...extRes.warnings);
    lastSyncedAt = Math.max(lastSyncedAt, extRes.lastSyncedAt);

    return apiOk({
      added,
      updated,
      unavailable,
      total: qwenTotal + extRes.total,
      externalTotal: extRes.total,
      lastSyncedAt,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
