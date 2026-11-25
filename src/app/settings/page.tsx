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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    keyUrlCheck: {
      ok: boolean;
      reason?: string;
    };
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Inspect provider environment status, test connectivity, and manage
            custom models &amp; style presets.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadAll()}
          className="gap-2"
        >
          <RefreshCw className="size-3.5" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Unconfigured guidance */}
      {(!status?.configured || status?.configError) && (
        <Card className="border-amber-700/50 bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-200">
              <AlertTriangle className="size-4 text-amber-400" />
              <span>Provider Not Configured</span>
            </CardTitle>
            <CardDescription className="text-amber-100/80">
              {status?.configError ??
                "Edit .env.local and restart the Next.js server to configure your API keys."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Secrets are never stored in SQLite or sent to the browser. Add{" "}
              <code className="font-mono text-foreground">QWEN_API_KEY</code>{" "}
              (standard <code className="font-mono">sk-...</code> or Token Plan{" "}
              <code className="font-mono">sk-sp-...</code>),{" "}
              <code className="font-mono text-foreground">QWEN_KEY_TYPE</code>,
              and{" "}
              <code className="font-mono text-foreground">QWEN_REGION</code> to{" "}
              <code className="font-mono text-foreground">.env.local</code>,
              then restart <code className="font-mono">bun run dev</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Provider Status */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Provider Status</CardTitle>
            <CardDescription>
              Read-only view of server environment configuration (keys masked).
            </CardDescription>
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
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.qwen && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-sm">
                  QwenCloud / DashScope
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{status.qwen.keyType}</Badge>
                  <Badge variant="outline">{status.qwen.region}</Badge>
                </div>
              </div>

              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Masked API Key</dt>
                  <dd className="font-mono mt-0.5">
                    {status.qwen.hasApiKey
                      ? status.qwen.maskedApiKey
                      : "Not set"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Resolved Base URL</dt>
                  <dd className="font-mono mt-0.5 break-all">
                    {status.qwen.baseUrl}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Default Models</dt>
                  <dd className="font-mono mt-0.5">
                    video: {status.qwen.models.video} · image:{" "}
                    {status.qwen.models.image}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Text &amp; TTS</dt>
                  <dd className="font-mono mt-0.5">
                    text: {status.qwen.models.text} · tts:{" "}
                    {status.qwen.models.tts}
                  </dd>
                </div>
              </dl>

              {!status.qwen.keyUrlCheck.ok && (
                <div className="flex items-start gap-2 rounded-md border border-red-800/60 bg-red-950/30 p-3 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
                  <span>
                    Key / URL mismatch: {status.qwen.keyUrlCheck.reason}
                  </span>
                </div>
              )}

              {testResults.qwen && (
                <div
                  className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${
                    testResults.qwen.ok
                      ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
                      : "border-red-800/60 bg-red-950/30 text-red-200"
                  }`}
                >
                  {testResults.qwen.ok ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
                  )}
                  <span>{testResults.qwen.detail}</span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                Text Refiner Provider
              </span>
              <Badge variant="secondary">
                {status?.textProvider ?? "qwen"}
              </Badge>
            </div>
            {status?.openaiCompat ? (
              <dl className="grid gap-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Base URL</dt>
                  <dd className="font-mono mt-0.5 break-all">
                    {status.openaiCompat.baseUrl}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="font-mono mt-0.5">
                    {status.openaiCompat.model}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Masked Key</dt>
                  <dd className="font-mono mt-0.5">
                    {status.openaiCompat.hasApiKey
                      ? status.openaiCompat.maskedApiKey
                      : "None"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">
                Using Qwen text model via DashScope compatible-mode endpoint.
              </p>
            )}

            {testResults.openaiCompat && (
              <div
                className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${
                  testResults.openaiCompat.ok
                    ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
                    : "border-red-800/60 bg-red-950/30 text-red-200"
                }`}
              >
                {testResults.openaiCompat.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
                )}
                <span>{testResults.openaiCompat.detail}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Custom Models */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Models</CardTitle>
          <CardDescription>
            Register new DashScope / Wan model IDs so they appear in model
            pickers without code edits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={handleAddCustomModel}
            className="grid gap-3 sm:grid-cols-5 items-end"
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
            <p className="text-xs text-muted-foreground">
              No custom models registered yet.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {customModels.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium">
                      {m.modelId}
                    </span>
                    <span className="text-xs text-muted-foreground">
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
                    size="sm"
                    onClick={() => void handleDeleteCustomModel(m.id)}
                    aria-label={`Delete ${m.modelId}`}
                  >
                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Style Presets */}
      <Card>
        <CardHeader>
          <CardTitle>Style Presets</CardTitle>
          <CardDescription>
            Reusable visual style bibles available when creating projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <div className="divide-y divide-border rounded-lg border border-border">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{preset.name}</span>
                    {preset.isBuiltin === 1 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Built-in
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {preset.styleBible}
                  </p>
                </div>
                {preset.isBuiltin === 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDeletePreset(preset.id)}
                    aria-label={`Delete ${preset.name}`}
                  >
                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
