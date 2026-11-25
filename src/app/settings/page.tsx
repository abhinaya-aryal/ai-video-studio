"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  CustomModel,
  CustomModelModality,
  StylePreset,
} from "@/db/schema";
import type { QwenKeyUrlCheck } from "@/lib/providers/qwen-endpoints";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface SettingsStatusResponse {
  configured: boolean;
  configError?: string;
  qwen: {
    hasApiKey: boolean;
    maskedApiKey: string;
    keyType: string;
    region: string;
    workspaceId: string | null;
    baseUrl: string;
    models: {
      video: string;
      image: string;
      tts: string;
      text: string;
    };
    keyUrlCheck: QwenKeyUrlCheck;
  } | null;
  textProvider: string | null;
  openaiCompat: {
    baseUrl: string;
    hasApiKey: boolean;
    maskedApiKey: string;
    model: string;
  } | null;
  jobs: {
    maxConcurrent: number;
    pollIntervalMs: number;
  } | null;
}

interface ConnectionCheckResult {
  ok: boolean;
  detail: string;
}

const MODALITIES: CustomModelModality[] = ["video", "image", "audio", "text"];
const FAMILIES = ["wan3", "wan2.7", "qwen-image", "qwen-tts", "text"];

const SECTION_LINKS = [
  { href: "#provider-status", label: "Provider Status" },
  { href: "#custom-models", label: "Custom Models" },
  { href: "#style-presets", label: "Style Presets" },
] as const;

export default function SettingsPage() {
  const [status, setStatus] = useState<SettingsStatusResponse | null>(null);
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [loading, setLoading] = useState(true);

  const [testingTarget, setTestingTarget] = useState<
    "qwen" | "openai_compat" | "all" | null
  >(null);
  const [testResults, setTestResults] = useState<{
    qwen?: ConnectionCheckResult;
    openaiCompat?: ConnectionCheckResult;
  }>({});

  // Custom model form
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [modality, setModality] = useState<CustomModelModality>("video");
  const [family, setFamily] = useState("wan3");
  const [savingModel, setSavingModel] = useState(false);

  // Style preset form
  const [presetName, setPresetName] = useState("");
  const [presetStyleBible, setPresetStyleBible] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [statusRes, modelsRes, presetsRes] = await Promise.all([
        fetch("/api/settings/status", { cache: "no-store" }),
        fetch("/api/settings/models", { cache: "no-store" }),
        fetch("/api/settings/presets", { cache: "no-store" }),
      ]);
      const [statusData, modelsData, presetsData] = await Promise.all([
        statusRes.json(),
        modelsRes.json(),
        presetsRes.json(),
      ]);
      setStatus(statusData);
      setCustomModels(
        Array.isArray(modelsData.customModels) ? modelsData.customModels : [],
      );
      setPresets(Array.isArray(presetsData.presets) ? presetsData.presets : []);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [statusRes, modelsRes, presetsRes] = await Promise.all([
          fetch("/api/settings/status", { cache: "no-store" }),
          fetch("/api/settings/models", { cache: "no-store" }),
          fetch("/api/settings/presets", { cache: "no-store" }),
        ]);
        const [statusData, modelsData, presetsData] = await Promise.all([
          statusRes.json(),
          modelsRes.json(),
          presetsRes.json(),
        ]);
        if (!active) return;
        setStatus(statusData);
        setCustomModels(
          Array.isArray(modelsData.customModels) ? modelsData.customModels : [],
        );
        setPresets(
          Array.isArray(presetsData.presets) ? presetsData.presets : [],
        );
      } catch {
        if (active) toast.error("Failed to load settings");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleTestConnection = async (
    target: "qwen" | "openai_compat" | "all",
  ) => {
    setTestingTarget(target);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        ...(data.qwen ? { qwen: data.qwen } : {}),
        ...(data.openaiCompat ? { openaiCompat: data.openaiCompat } : {}),
      }));
      if (data.ok) {
        toast.success("Connection check passed");
      } else {
        toast.error(
          data.qwen?.detail ??
            data.openaiCompat?.detail ??
            "Connection check failed",
        );
      }
    } catch {
      toast.error("Connection test request failed");
    } finally {
      setTestingTarget(null);
    }
  };

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
      await loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save custom model",
      );
    } finally {
      setSavingModel(false);
    }
  };

  const handleDeleteCustomModel = async (id: string) => {
    try {
      const res = await fetch(
        `/api/settings/models?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error?.message ?? "Failed to delete model");
      }
      toast.success("Custom model removed");
      await loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete model",
      );
    }
  };

  const handleAddPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetName.trim() || !presetStyleBible.trim()) {
      toast.error("Preset name and style bible are required");
      return;
    }

    setSavingPreset(true);
    try {
      const res = await fetch("/api/settings/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: presetName.trim(),
          styleBible: presetStyleBible.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to create preset");
      }
      toast.success(`Added preset "${data.preset.name}"`);
      setPresetName("");
      setPresetStyleBible("");
      await loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create preset",
      );
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (id: string) => {
    try {
      const res = await fetch(
        `/api/settings/presets?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error?.message ?? "Failed to delete preset");
      }
      toast.success("Style preset deleted");
      await loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete preset",
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span>Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Inspect provider environment status, test connectivity, and manage custom models & style presets."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadAll()}
            className="gap-2"
          >
            <RefreshCw className="size-3.5" />
            <span>Refresh</span>
          </Button>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <nav
            aria-label="Settings sections"
            className="panel flex flex-wrap gap-1 p-2 lg:flex-col"
          >
            {SECTION_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {/* Unconfigured guidance */}
          {(!status?.configured || status?.configError) && (
            <section className="panel space-y-2 border-warning/40 bg-warning/10 p-5">
              <div className="flex items-center gap-2 text-base font-semibold text-warning">
                <AlertTriangle className="size-4 shrink-0 text-warning" />
                <span>Provider Not Configured</span>
              </div>
              <p className="text-sm text-foreground/90">
                {status?.configError ??
                  "Edit .env.local and restart the Next.js server to configure your API keys."}
              </p>
              <p className="text-xs text-muted-foreground">
                Secrets are never stored in SQLite or sent to the browser. Add{" "}
                <code className="font-mono text-foreground">QWEN_API_KEY</code>{" "}
                (standard <code className="font-mono">sk-...</code> or Token
                Plan <code className="font-mono">sk-sp-...</code>),{" "}
                <code className="font-mono text-foreground">QWEN_KEY_TYPE</code>
                , and{" "}
                <code className="font-mono text-foreground">QWEN_REGION</code>{" "}
                to <code className="font-mono text-foreground">.env.local</code>
                , then restart <code className="font-mono">bun run dev</code>.
              </p>
            </section>
          )}

          {/* Provider Status */}
          <section
            id="provider-status"
            className="panel scroll-mt-8 space-y-5 p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  Provider Status
                </h2>
                <p className="text-xs text-muted-foreground">
                  Read-only view of server environment configuration (keys
                  masked).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingTarget !== null}
                  onClick={() => void handleTestConnection("qwen")}
                >
                  {testingTarget === "qwen" && (
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                  )}
                  Test Qwen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingTarget !== null}
                  onClick={() => void handleTestConnection("openai_compat")}
                >
                  {testingTarget === "openai_compat" && (
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                  )}
                  Test OpenAI-Compat
                </Button>
                <Button
                  size="sm"
                  disabled={testingTarget !== null}
                  onClick={() => void handleTestConnection("all")}
                >
                  {testingTarget === "all" && (
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                  )}
                  Test All
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {status?.qwen && (
                <div className="space-y-3 rounded-xl border border-border bg-surface-2/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      QwenCloud / DashScope
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{status.qwen.keyType}</Badge>
                      <Badge variant="outline">{status.qwen.region}</Badge>
                    </div>
                  </div>

                  <dl className="grid gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-subtle-foreground">Masked API Key</dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        {status.qwen.hasApiKey
                          ? status.qwen.maskedApiKey
                          : "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle-foreground">
                        Resolved Base URL
                      </dt>
                      <dd className="mt-0.5 break-all font-mono text-foreground">
                        {status.qwen.baseUrl}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle-foreground">Default Models</dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        video: {status.qwen.models.video} · image:{" "}
                        {status.qwen.models.image}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle-foreground">Text &amp; TTS</dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        text: {status.qwen.models.text} · tts:{" "}
                        {status.qwen.models.tts}
                      </dd>
                    </div>
                  </dl>

                  {!status.qwen.keyUrlCheck.ok && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <span>
                        Key / URL mismatch: {status.qwen.keyUrlCheck.warning}
                      </span>
                    </div>
                  )}

                  {testResults.qwen && (
                    <div
                      className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                        testResults.qwen.ok
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-destructive/40 bg-destructive/10 text-destructive"
                      }`}
                    >
                      {testResults.qwen.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      )}
                      <span className="min-w-0 break-words">
                        {testResults.qwen.detail}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2.5 rounded-xl border border-border bg-surface-2/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    Text Refiner Provider
                  </span>
                  <Badge variant="secondary">
                    {status?.textProvider ?? "qwen"}
                  </Badge>
                </div>
                {status?.openaiCompat ? (
                  <dl className="grid gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-subtle-foreground">Base URL</dt>
                      <dd className="mt-0.5 break-all font-mono text-foreground">
                        {status.openaiCompat.baseUrl}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle-foreground">Model</dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        {status.openaiCompat.model}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle-foreground">Masked Key</dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        {status.openaiCompat.hasApiKey
                          ? status.openaiCompat.maskedApiKey
                          : "None"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Using Qwen text model via DashScope compatible-mode
                    endpoint.
                  </p>
                )}

                {testResults.openaiCompat && (
                  <div
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                      testResults.openaiCompat.ok
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-destructive/40 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {testResults.openaiCompat.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0 break-words">
                      {testResults.openaiCompat.detail}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Custom Models */}
          <section
            id="custom-models"
            className="panel scroll-mt-8 space-y-5 p-6"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Custom Models
              </h2>
              <p className="text-xs text-muted-foreground">
                Register new DashScope / Wan model IDs so they appear in model
                pickers without code edits.
              </p>
            </div>

            <form
              onSubmit={handleAddCustomModel}
              className="grid items-end gap-3 sm:grid-cols-5"
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
                  onValueChange={(v) =>
                    v && setModality(v as CustomModelModality)
                  }
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
                <Select
                  value={family}
                  onValueChange={(v) => v && setFamily(v)}
                >
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

            {customModels.length === 0 ? (
              <p className="text-xs text-subtle-foreground">
                No custom models registered yet.
              </p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-surface-2/30">
                {customModels.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-xs font-medium text-foreground">
                        {m.modelId}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {m.displayName}
                      </span>
                      <Badge variant="secondary" className="text-[11px]">
                        {m.modality}
                      </Badge>
                      <Badge variant="outline" className="text-[11px]">
                        {m.family}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleDeleteCustomModel(m.id)}
                      aria-label={`Delete ${m.modelId}`}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Style Presets */}
          <section
            id="style-presets"
            className="panel scroll-mt-8 space-y-5 p-6"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Style Presets
              </h2>
              <p className="text-xs text-muted-foreground">
                Reusable visual style bibles available when creating projects.
              </p>
            </div>

            <form onSubmit={handleAddPreset} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="preset-name">
                    Preset Name
                  </label>
                  <Input
                    id="preset-name"
                    placeholder="e.g., Ghibli Watercolor"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium" htmlFor="preset-bible">
                    Style Bible
                  </label>
                  <Textarea
                    id="preset-bible"
                    rows={2}
                    placeholder="Hand-painted gouache backgrounds, soft afternoon sunlight..."
                    value={presetStyleBible}
                    onChange={(e) => setPresetStyleBible(e.target.value)}
                  />
                </div>
              </div>
              <Button type="submit" disabled={savingPreset} className="gap-1.5">
                {savingPreset ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                <span>Add Style Preset</span>
              </Button>
            </form>

            {presets.length === 0 ? (
              <p className="text-xs text-subtle-foreground">
                No style presets configured yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex flex-col justify-between gap-2.5 rounded-xl border border-border bg-surface-2/30 p-3.5"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {preset.name}
                        </span>
                        {preset.isBuiltin === 1 && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-[10px]"
                          >
                            Built-in
                          </Badge>
                        )}
                      </div>
                      <p className="line-clamp-3 text-xs text-muted-foreground">
                        {preset.styleBible}
                      </p>
                    </div>
                    {preset.isBuiltin === 0 && (
                      <div className="flex justify-end border-t border-border pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void handleDeletePreset(preset.id)}
                          aria-label={`Delete ${preset.name}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
