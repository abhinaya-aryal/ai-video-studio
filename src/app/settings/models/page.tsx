"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Plus, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { CustomModelModality } from "@/db/schema";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const MODALITIES: CustomModelModality[] = ["video", "image", "audio", "text"];
const FAMILIES = ["wan3", "wan2.7", "qwen-image", "qwen-tts", "text"];

const ROLES = [
  { slot: "text_refine", label: "Story refine", modality: "text" },
  { slot: "text_polish", label: "Prompt polish", modality: "text" },
  { slot: "image", label: "Images", modality: "image" },
  { slot: "video", label: "Video", modality: "video" },
  { slot: "audio", label: "Voiceover", modality: "audio" },
] as const;

const PRESETS = ["quality", "balanced", "economy"] as const;
type Preset = (typeof PRESETS)[number];

interface RegistryModel {
  id: string;
  modelId: string;
  displayName: string;
  modality: string;
  family: string;
  source: "manual" | "discovered";
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

interface ResolvedRow {
  slot: string;
  modelId: string | null;
  source: string;
  reason: string;
}

interface UsageSummary {
  totals: { totalTokens: number; inputTokens: number; outputTokens: number };
  byModality: Array<{ modality: string; totalTokens: number; events: number }>;
  topModels: Array<{ modelId: string; totalTokens: number; events: number }>;
}

export default function ModelsPage() {
  const [models, setModels] = useState<RegistryModel[]>([]);
  const [selections, setSelections] = useState<SelectionRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
  const [autoPreset, setAutoPreset] = useState<Preset>("balanced");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);

  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [modality, setModality] = useState<CustomModelModality>("video");
  const [family, setFamily] = useState("wan3");
  const [savingModel, setSavingModel] = useState(false);

  const [editing, setEditing] = useState<RegistryModel | null>(null);
  const [editorJson, setEditorJson] = useState("");
  const [savingRules, setSavingRules] = useState(false);

  const applyPayload = useCallback(
    (data: {
      models?: RegistryModel[];
      selections?: SelectionRow[];
      resolved?: ResolvedRow[];
      autoPreset?: Preset;
      lastSyncedAt?: number | null;
      syncWarning?: string | null;
    }) => {
      if (Array.isArray(data.models)) setModels(data.models);
      if (Array.isArray(data.selections)) setSelections(data.selections);
      if (Array.isArray(data.resolved)) setResolved(data.resolved);
      if (data.autoPreset) setAutoPreset(data.autoPreset);
      setLastSyncedAt(data.lastSyncedAt ?? null);
      setSyncWarning(data.syncWarning ?? null);
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

  const resolvedBySlot = useMemo(
    () => new Map(resolved.map((row) => [row.slot, row])),
    [resolved],
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/settings/models/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Model sync failed");
      }
      toast.success(
        `Synced ${data.total} models (${data.added} new, ${data.unavailable} unavailable)`,
      );
      await loadModels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Model sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleSlotChange = async (slot: string, value: string) => {
    setSavingSlot(slot);
    try {
      const res = await fetch("/api/settings/models/selections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [
            value === "__auto__"
              ? { slot, mode: "auto" }
              : { slot, mode: "manual", modelId: value },
          ],
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
      setSavingSlot(null);
    }
  };

  const handleUseAutoForAll = async () => {
    setSavingSlot("all");
    try {
      const res = await fetch("/api/settings/models/selections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: ROLES.map((role) => ({ slot: role.slot, mode: "auto" })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to apply Auto");
      }
      applyPayload(data);
      toast.success("Auto applied to every role");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply Auto");
    } finally {
      setSavingSlot(null);
    }
  };

  const handlePresetChange = async (preset: Preset) => {
    try {
      const res = await fetch("/api/settings/models/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPreset: preset }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save preset");
      }
      applyPayload({ ...data, autoPreset: data.autoPreset });
      toast.success(`${preset} preset saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save preset");
    }
  };

  const eligibleModels = useCallback(
    (slot: string, slotModality: string) =>
      models.filter((model) => {
        if (!model.available || model.ignored) return false;
        if (model.modality !== slotModality) return false;
        if (slot === "audio" && model.ttsCapable === false) return false;
        return true;
      }),
    [models],
  );

  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelId.trim() || !displayName.trim()) {
      toast.error("Model ID and display name are required");
      return;
    }

    setSavingModel(true);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: modelId.trim(),
          displayName: displayName.trim(),
          modality,
          family,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save custom model");
      }
      toast.success(`Saved model "${data.model.modelId}"`);
      setModelId("");
      setDisplayName("");
      await loadModels();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save custom model",
      );
    } finally {
      setSavingModel(false);
    }
  };

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
          : "Custom model removed",
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
        description="Every model your token can use. Choose a model per role, or let Auto pick a quality and cost balance."
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Auto</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Auto resolves each role from the synced list. Quality spends
              more, Economy spends less, Balanced sits in the middle. Every
              role can still be overridden.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={savingSlot === "all"}
            onClick={() => void handleUseAutoForAll()}
          >
            <Wand2 className="size-3.5" />
            <span>Use Auto for all</span>
          </Button>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => void handlePresetChange(preset)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                autoPreset === preset
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {ROLES.map((role) => {
            const selection = selections.find((row) => row.slot === role.slot);
            const current = selection
              ? selection.mode === "auto"
                ? "__auto__"
                : (selection.modelId ?? "__auto__")
              : "__none__";
            const effective = resolvedBySlot.get(role.slot);
            const options = eligibleModels(role.slot, role.modality);

            return (
              <div
                key={role.slot}
                className="grid gap-2 rounded-lg border border-border bg-surface-2/20 px-3 py-2.5 sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
              >
                <div className="text-xs font-medium text-foreground">
                  {role.label}
                </div>
                <Select
                  value={current}
                  onValueChange={(value) =>
                    void handleSlotChange(role.slot, value ?? "")
                  }
                  disabled={savingSlot === role.slot}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {current === "__none__"
                        ? "Select a model"
                        : current === "__auto__"
                          ? "Auto"
                          : current}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>
                      Select a model
                    </SelectItem>
                    <SelectItem value="__auto__">Auto</SelectItem>
                    {options.map((option) => (
                      <SelectItem key={option.modelId} value={option.modelId}>
                        {option.modelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="min-w-0 text-xs text-muted-foreground">
                  {effective?.modelId ? (
                    <span className="truncate">
                      {effective.modelId} ({effective.source})
                    </span>
                  ) : (
                    <span className="text-warning">Not resolved</span>
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
              Token counts reported by the provider. Syncing models and opening
              this page spend nothing.
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
            Synced models
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Token models come from the provider. Manual models let you reach
            IDs the token does not list.
          </p>
        </div>

        {models.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No models yet"
            description="Sync the token list, or add a model ID manually below."
            className="border-dashed bg-surface-2/20 py-8 shadow-none"
          />
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface-2/30">
            {models.map((model) => (
              <div
                key={model.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="truncate font-mono text-xs font-medium text-foreground">
                    {model.modelId}
                  </span>
                  <Badge variant="secondary" className="text-[11px]">
                    {model.modality}
                  </Badge>
                  <Badge variant="outline" className="text-[11px]">
                    {model.source === "discovered" ? "Token" : "Manual"}
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
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={handleAddCustomModel}
          className="grid items-end gap-3 border-t border-border pt-5 sm:grid-cols-5"
        >
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="cm-id">
              Model ID
            </label>
            <Input
              id="cm-id"
              placeholder="wan3.5-video"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="cm-name">
              Display Name
            </label>
            <Input
              id="cm-name"
              placeholder="Wan 3.5 Video"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Modality</label>
            <Select
              value={modality}
              onValueChange={(v) => v && setModality(v as CustomModelModality)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{modality}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODALITIES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Family</label>
            <Select value={family} onValueChange={(v) => v && setFamily(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{family}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={savingModel} className="gap-1.5">
            {savingModel ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            <span>Add Model</span>
          </Button>
        </form>
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