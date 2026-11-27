"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const ROLES = [
  {
    key: "text",
    slots: ["text_refine", "text_polish"] as const,
    label: "Text (Refine & Polish)",
    modality: "text",
  },
  {
    key: "image",
    slots: ["image"] as const,
    label: "Images",
    modality: "image",
  },
  {
    key: "video",
    slots: ["video"] as const,
    label: "Video",
    modality: "video",
  },
  {
    key: "audio",
    slots: ["audio"] as const,
    label: "Voiceover",
    modality: "audio",
  },
] as const;

interface RegistryModel {
  id: string;
  modelId: string;
  displayName: string;
  modality: string;
  family: string;
  source: "manual" | "discovered";
  providerId?: string;
  providerName?: string;
  providerKind?: "qwen" | "gemini" | "openai_compat";
  available: boolean;
  ignored: boolean;
  capabilitiesEdited: boolean;
  capabilitiesJson: string;
  ttsCapable?: boolean;
}

interface SelectionRow {
  slot: string;
  mode: "auto" | "manual";
  modelId: string | null;
}

interface RoleProviderBindings {
  text_refine?: { providerId: string; modelId?: string };
  text_polish?: { providerId: string; modelId?: string };
  image?: { providerId: string; modelId?: string };
  video?: { providerId: string; modelId?: string };
  audio?: { providerId: string; modelId?: string };
}

interface UsageSummary {
  totals: { totalTokens: number; inputTokens: number; outputTokens: number };
  byModality: Array<{ modality: string; totalTokens: number; events: number }>;
  topModels: Array<{ modelId: string; totalTokens: number; events: number }>;
}

const EXT_VALUE_PREFIX = "ext::";

function encodeExternalSelection(providerId: string, modelId: string): string {
  return `${EXT_VALUE_PREFIX}${providerId}::${modelId}`;
}

function decodeExternalSelection(
  value: string,
): { providerId: string; modelId: string } | null {
  if (!value.startsWith(EXT_VALUE_PREFIX)) return null;
  const rest = value.slice(EXT_VALUE_PREFIX.length);
  const sep = rest.indexOf("::");
  if (sep === -1) return null;
  return {
    providerId: rest.slice(0, sep),
    modelId: rest.slice(sep + 2),
  };
}

export default function ModelsPage() {
  const [models, setModels] = useState<RegistryModel[]>([]);
  const [externalModels, setExternalModels] = useState<RegistryModel[]>([]);
  const [selections, setSelections] = useState<SelectionRow[]>([]);
  const [roleProviders, setRoleProviders] = useState<RoleProviderBindings>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const [editing, setEditing] = useState<RegistryModel | null>(null);
  const [editorJson, setEditorJson] = useState("");
  const [savingRules, setSavingRules] = useState(false);

  const applyPayload = useCallback(
    (data: {
      models?: RegistryModel[];
      externalModels?: RegistryModel[];
      selections?: SelectionRow[];
      roleProviders?: RoleProviderBindings;
      lastSyncedAt?: number | null;
      syncWarning?: string | null;
    }) => {
      if (Array.isArray(data.models)) setModels(data.models);
      if (Array.isArray(data.externalModels)) {
        setExternalModels(data.externalModels);
      }
      if (Array.isArray(data.selections)) setSelections(data.selections);
      if (data.roleProviders) setRoleProviders(data.roleProviders);
      if (data.lastSyncedAt !== undefined) {
        setLastSyncedAt(data.lastSyncedAt ?? null);
      }
      if (data.syncWarning !== undefined) {
        setSyncWarning(data.syncWarning ?? null);
      }
    },
    [],
  );

  const fetchPayload = useCallback(async () => {
    const [modelsRes, usageRes] = await Promise.all([
      fetch("/api/settings/models", { cache: "no-store" }),
      fetch("/api/settings/usage?range=7d", { cache: "no-store" }),
    ]);
    const data = await modelsRes.json();
    const usageData = usageRes.ok ? await usageRes.json() : null;
    return { data, usageData };
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const { data, usageData } = await fetchPayload();
      applyPayload(data);
      if (usageData?.totals) setUsage(usageData);
    } catch {
      toast.error("Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [applyPayload, fetchPayload]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, usageData } = await fetchPayload();
        if (!active) return;
        applyPayload(data);
        if (usageData?.totals) setUsage(usageData);
      } catch {
        if (active) toast.error("Failed to load models");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyPayload, fetchPayload]);

  const allModels = useMemo(
    () => [...models, ...externalModels],
    [models, externalModels],
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/settings/models/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Model sync failed");
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        toast.warning(
          `Synced ${data.total} models with warnings: ${data.warnings.join("; ")}`,
        );
      } else {
        toast.success(`Synced ${data.total} models across all providers`);
      }
      await loadModels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Model sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleRoleChange = async (
    roleKey: string,
    slots: readonly string[],
    value: string,
  ) => {
    if (!value || value === "__none__") return;
    setSavingRole(roleKey);
    try {
      const ext = decodeExternalSelection(value);

      if (ext) {
        const binding = { providerId: ext.providerId, modelId: ext.modelId };
        const rolePatch: Record<string, { providerId: string; modelId: string }> =
          {};
        for (const slot of slots) {
          rolePatch[slot] = binding;
        }
        const res = await fetch("/api/settings/app", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleProviders: rolePatch }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Failed to save selection");
        }
        setRoleProviders(data.roleProviders ?? {});
        toast.success("Model selection saved");
        return;
      }

      const hasExistingExtBinding = slots.some(
        (slot) => Boolean(roleProviders[slot as keyof RoleProviderBindings]),
      );
      if (hasExistingExtBinding) {
        const clearPatch: Record<string, null> = {};
        for (const slot of slots) {
          clearPatch[slot] = null;
        }
        const clearRes = await fetch("/api/settings/app", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleProviders: clearPatch }),
        });
        if (clearRes.ok) {
          const cleared = await clearRes.json();
          setRoleProviders(cleared.roleProviders ?? {});
        }
      }

      const res = await fetch("/api/settings/models/selections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: slots.map((slot) => ({
            slot,
            mode: "manual",
            modelId: value,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save selection");
      }
      applyPayload(data);
      toast.success("Model selection saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save selection",
      );
    } finally {
      setSavingRole(null);
    }
  };

  const eligibleQwenModels = useCallback(
    (roleKey: string, slotModality: string) =>
      models.filter((model) => {
        if (!model.available || model.ignored) return false;
        if (model.modality !== slotModality) return false;
        if (roleKey === "audio" && model.ttsCapable === false) return false;
        return true;
      }),
    [models],
  );

  const handleDeleteModel = async (model: RegistryModel) => {
    try {
      const res = await fetch(
        `/api/settings/models?id=${encodeURIComponent(model.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error?.message ?? "Failed to remove model");
      }
      toast.success(
        model.source === "discovered"
          ? "Model hidden from pickers"
          : "Model removed",
      );
      await loadModels();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove model",
      );
    }
  };

  const handleUnhide = async (model: RegistryModel) => {
    try {
      const res = await fetch(
        `/api/settings/models/${encodeURIComponent(model.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ignored: false }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error?.message ?? "Failed to restore model");
      }
      toast.success("Model restored");
      await loadModels();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to restore model",
      );
    }
  };

  const openEditor = (model: RegistryModel) => {
    setEditing(model);
    setEditorJson(model.capabilitiesJson || "{}");
  };

  const handleSaveRules = async () => {
    if (!editing) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editorJson);
    } catch {
      toast.error("Capabilities must be valid JSON");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      toast.error("Capabilities must be a JSON object");
      return;
    }
    setSavingRules(true);
    try {
      const res = await fetch(
        `/api/settings/models/${encodeURIComponent(editing.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capabilities: parsed }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save rules");
      }
      toast.success("Capability rules saved");
      setEditing(null);
      await loadModels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rules");
    } finally {
      setSavingRules(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span>Loading models...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title={
          <>
            <span className="prism-text">Models</span>
          </>
        }
        description="All available models retrieved from your configured providers using your API keys. Explicitly choose a model for each task."
        actions={
          <div className="flex items-center gap-2">
            {lastSyncedAt && (
              <span className="text-xs text-muted-foreground">
                Synced {new Date(lastSyncedAt).toLocaleString()}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="gap-2"
            >
              {syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span>Sync models</span>
            </Button>
          </div>
        }
      />

      {syncWarning && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {syncWarning}
        </p>
      )}

      <section className="panel space-y-4 p-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Task Model Assignment
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Explicitly choose a model from any configured provider for each
            task. Projects and Quick Clip require your models to be selected
            here.
          </p>
        </div>

        <div className="space-y-2">
          {ROLES.map((role) => {
            const isTextRole = role.key === "text";
            const primarySlot = role.slots[0];
            const extBinding = isTextRole
              ? (roleProviders.text_polish?.modelId
                  ? roleProviders.text_polish
                  : roleProviders.text_refine)
              : roleProviders[primarySlot as keyof RoleProviderBindings];
            const extMatch =
              extBinding && extBinding.modelId
                ? externalModels.find(
                    (m) =>
                      m.providerId === extBinding.providerId &&
                      m.modelId === extBinding.modelId,
                  )
                : undefined;

            const selection = selections.find(
              (row) => row.slot === primarySlot,
            );
            const manualModelId =
              selection?.mode === "manual" ? selection.modelId : null;
            const current =
              extBinding && extBinding.modelId
                ? encodeExternalSelection(
                    extBinding.providerId,
                    extBinding.modelId,
                  )
                : manualModelId || "__none__";

            const qwenOptions = eligibleQwenModels(role.key, role.modality);
            const extOptions = externalModels.filter((model) => {
              if (!model.available || model.ignored) return false;
              if (model.modality !== role.modality) return false;
              if (role.key === "audio" && model.ttsCapable === false) {
                return false;
              }
              return true;
            });

            const currentLabel =
              current === "__none__"
                ? "Select a model"
                : extBinding && extBinding.modelId
                  ? `${extBinding.modelId}${extMatch?.providerName ? ` · ${extMatch.providerName}` : ""}`
                  : current;

            return (
              <div
                key={role.key}
                className="grid gap-2 rounded-lg border border-border bg-surface-2/20 px-3 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
              >
                <div className="text-xs font-medium text-foreground">
                  {role.label}
                </div>
                <Select
                  value={current}
                  onValueChange={(value) =>
                    void handleRoleChange(role.key, role.slots, value ?? "")
                  }
                  disabled={savingRole === role.key}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{currentLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>
                      Select a model
                    </SelectItem>
                    {qwenOptions.map((option) => (
                      <SelectItem
                        key={`qwen:${option.modelId}`}
                        value={option.modelId}
                      >
                        {option.modelId}
                        {option.providerName ? ` · ${option.providerName}` : ""}
                      </SelectItem>
                    ))}
                    {extOptions.map((option) => (
                      <SelectItem
                        key={option.id}
                        value={encodeExternalSelection(
                          option.providerId!,
                          option.modelId,
                        )}
                      >
                        {option.modelId} · {option.providerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="min-w-0 text-xs text-muted-foreground">
                  {extBinding && extBinding.modelId ? (
                    <span className="truncate">
                      {extBinding.modelId} (
                      {extMatch?.providerName ?? extBinding.providerId})
                    </span>
                  ) : manualModelId ? (
                    <span className="truncate">{manualModelId}</span>
                  ) : (
                    <span className="text-warning">Not selected</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Usage, last 7 days
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Token counts reported by providers. Syncing models spends nothing.
            </p>
          </div>
          <Badge variant="outline" className="font-mono tabular-nums">
            {(usage?.totals.totalTokens ?? 0).toLocaleString()} tokens
          </Badge>
        </div>
        {usage && usage.byModality.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {usage.byModality.map((row) => (
              <div
                key={row.modality}
                className="rounded-lg border border-border bg-surface-2/20 px-3 py-2"
              >
                <div className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                  {row.modality}
                </div>
                <div className="mt-0.5 font-mono text-sm tabular-nums text-foreground">
                  {row.totalTokens.toLocaleString()}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {row.events} events
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No usage recorded yet. Generation runs appear here.
          </p>
        )}
      </section>

      <section className="panel space-y-5 p-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Available Models ({allModels.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All models retrieved from your configured providers. Press Sync
            models above to refresh from every provider.
          </p>
        </div>

        {allModels.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No models yet"
            description="Add a provider with your API key in Settings → Providers, then press Sync models."
            className="border-dashed bg-surface-2/20 py-8 shadow-none"
          />
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface-2/30">
            {allModels.map((model) => {
              const isExternal =
                model.providerKind === "gemini" ||
                model.providerKind === "openai_compat";
              return (
                <div
                  key={model.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span className="truncate font-mono text-xs font-medium text-foreground">
                      {model.modelId}
                    </span>
                    {model.providerName && (
                      <Badge variant="outline" className="text-[11px]">
                        {model.providerName}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[11px]">
                      {model.modality}
                    </Badge>
                    {model.capabilitiesEdited && (
                      <Badge variant="outline" className="text-[11px]">
                        Edited rules
                      </Badge>
                    )}
                    {!model.available && (
                      <Badge variant="destructive" className="text-[11px]">
                        Unavailable
                      </Badge>
                    )}
                    {model.ignored && (
                      <Badge variant="outline" className="text-[11px]">
                        Hidden
                      </Badge>
                    )}
                  </div>
                  {!isExternal && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => openEditor(model)}
                      >
                        Rules
                      </Button>
                      {model.ignored ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => void handleUnhide(model)}
                        >
                          Unhide
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void handleDeleteModel(model)}
                          aria-label={`Remove ${model.modelId}`}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Capability rules</DialogTitle>
            <DialogDescription>
              {editing?.modelId}. Edit the inferred media rules. Saving marks
              the row as edited so sync will not overwrite it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editorJson}
            onChange={(e) => setEditorJson(e.target.value)}
            rows={12}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={savingRules}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleSaveRules()} disabled={savingRules}>
              {savingRules && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
