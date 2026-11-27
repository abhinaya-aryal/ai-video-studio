"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { QwenKeyUrlCheck } from "@/lib/providers/qwen-endpoints";
import type {
  ProviderKind,
  ProviderPreset,
  ProviderPresetId,
} from "@/lib/settings/store";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderView {
  id: string;
  name: string;
  kind: ProviderKind;
  preset?: ProviderPresetId;
  keyType?: "auto" | "token_plan" | "standard";
  region?: "ap-southeast-1" | "cn-beijing";
  workspaceId?: string;
  baseUrl?: string;
  enabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string;
  resolvedKeyType?: string;
  resolvedBaseUrl: string;
  keyUrlCheck: QwenKeyUrlCheck;
}

interface AppSettingsView {
  projectsDir: string;
  maxConcurrentJobs: number;
  jobPollIntervalMs: number;
}

interface ConnectionCheckResult {
  ok: boolean;
  detail: string;
}

interface ProviderFormState {
  id: string | null;
  name: string;
  kind: ProviderKind;
  preset: ProviderPresetId;
  apiKey: string;
  clearApiKey: boolean;
  keyType: "auto" | "token_plan" | "standard";
  region: "ap-southeast-1" | "cn-beijing";
  workspaceId: string;
  baseUrl: string;
  enabled: boolean;
}

function emptyFormForPreset(preset: ProviderPreset): ProviderFormState {
  return {
    id: null,
    name: preset.label,
    kind: preset.kind,
    preset: preset.id,
    apiKey: "",
    clearApiKey: false,
    keyType: "auto",
    region: "ap-southeast-1",
    workspaceId: "",
    baseUrl: preset.baseUrl ?? "",
    enabled: true,
  };
}

export default function ProvidersSettingsPage() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettingsView>({
    projectsDir: "~/projects",
    maxConcurrentJobs: 3,
    jobPollIntervalMs: 10000,
  });
  const [usage, setUsage] = useState<{
    totals: { totalTokens: number };
    byModality: Array<{ modality: string; totalTokens: number; events: number }>;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, ConnectionCheckResult>
  >({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProviderFormState | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [pickingDir, setPickingDir] = useState(false);
  const [savingApp, setSavingApp] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [provRes, usageRes] = await Promise.all([
        fetch("/api/settings/providers", { cache: "no-store" }),
        fetch("/api/settings/usage?range=7d", { cache: "no-store" }),
      ]);
      const provData = await provRes.json();
      if (!provRes.ok) {
        throw new Error(provData?.error?.message ?? "Failed to load providers");
      }
      setProviders(Array.isArray(provData.providers) ? provData.providers : []);
      setPresets(Array.isArray(provData.presets) ? provData.presets : []);
      if (provData.app) {
        setAppSettings({
          projectsDir: String(provData.app.projectsDir ?? "~/projects"),
          maxConcurrentJobs: Number(provData.app.maxConcurrentJobs ?? 3),
          jobPollIntervalMs: Number(provData.app.jobPollIntervalMs ?? 10000),
        });
      }
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        if (usageData?.totals) setUsage(usageData);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load provider settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [provRes, usageRes] = await Promise.all([
          fetch("/api/settings/providers", { cache: "no-store" }),
          fetch("/api/settings/usage?range=7d", { cache: "no-store" }),
        ]);
        const provData = await provRes.json();
        if (!provRes.ok) {
          throw new Error(
            provData?.error?.message ?? "Failed to load providers",
          );
        }
        if (!active) return;
        setProviders(
          Array.isArray(provData.providers) ? provData.providers : [],
        );
        setPresets(Array.isArray(provData.presets) ? provData.presets : []);
        if (provData.app) {
          setAppSettings({
            projectsDir: String(provData.app.projectsDir ?? "~/projects"),
            maxConcurrentJobs: Number(provData.app.maxConcurrentJobs ?? 3),
            jobPollIntervalMs: Number(provData.app.jobPollIntervalMs ?? 10000),
          });
        }
        if (usageRes.ok) {
          const usageData = await usageRes.json();
          if (active && usageData?.totals) setUsage(usageData);
        }
      } catch (err) {
        if (active) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to load provider settings",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const openAddDialog = () => {
    const chosen = presets[0] ?? {
      id: "qwen" as const,
      label: "QwenCloud / DashScope",
      kind: "qwen" as const,
      description: "",
    };
    setForm(emptyFormForPreset(chosen));
    setDialogOpen(true);
  };

  const openEditDialog = (provider: ProviderView) => {
    setForm({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      preset:
        provider.preset ??
        (provider.kind === "qwen" ? "qwen" : "custom"),
      apiKey: "",
      clearApiKey: false,
      keyType: provider.keyType ?? "auto",
      region: provider.region ?? "ap-southeast-1",
      workspaceId: provider.workspaceId ?? "",
      baseUrl: provider.baseUrl ?? "",
      enabled: provider.enabled,
    });
    setDialogOpen(true);
  };

  const handleSelectPreset = (preset: ProviderPreset) => {
    setForm((prev) =>
      prev
        ? {
            ...emptyFormForPreset(preset),
            id: prev.id,
            apiKey: prev.apiKey,
          }
        : emptyFormForPreset(preset),
    );
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) {
      toast.error("Provider name is required");
      return;
    }
    if (form.kind === "openai_compat" && !form.baseUrl.trim()) {
      toast.error("Base URL is required");
      return;
    }
    if (/^https?:\/\//i.test(form.apiKey.trim())) {
      toast.error("API Key looks like a URL — paste your actual API key instead.");
      return;
    }

    setSavingProvider(true);
    try {
      const isEdit = Boolean(form.id);
      const url = isEdit
        ? `/api/settings/providers/${encodeURIComponent(form.id!)}`
        : "/api/settings/providers";
      const method = isEdit ? "PATCH" : "POST";

      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        preset: form.preset,
        enabled: form.enabled,
        ...(isEdit ? {} : { kind: form.kind }),
        ...(form.kind === "qwen"
          ? {
              keyType: form.keyType,
              region: form.region,
              ...(isEdit
                ? {
                    workspaceId: form.workspaceId.trim() || null,
                    baseUrl: form.baseUrl.trim() || null,
                  }
                : {
                    ...(form.workspaceId.trim()
                      ? { workspaceId: form.workspaceId.trim() }
                      : {}),
                    ...(form.baseUrl.trim()
                      ? { baseUrl: form.baseUrl.trim() }
                      : {}),
                  }),
            }
          : form.kind === "gemini"
            ? {
                ...(isEdit
                  ? { baseUrl: form.baseUrl.trim() || null }
                  : form.baseUrl.trim()
                    ? { baseUrl: form.baseUrl.trim() }
                    : {}),
              }
            : {
                baseUrl: form.baseUrl.trim(),
              }),
      };

      if (form.clearApiKey) {
        payload.clearApiKey = true;
      } else if (form.apiKey.trim()) {
        payload.apiKey = form.apiKey.trim();
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save provider");
      }

      const synced = Number(data.syncedModelsCount ?? 0);
      if (synced > 0) {
        toast.success(
          `${isEdit ? "Updated" : "Added"} "${data.provider.name}" (${synced} models synced)`,
        );
      } else if (data.syncWarning) {
        toast.warning(
          `Saved "${data.provider.name}", but model sync failed: ${data.syncWarning}`,
        );
      } else {
        toast.success(
          isEdit
            ? `Updated "${data.provider.name}"`
            : `Added "${data.provider.name}"`,
        );
      }
      setDialogOpen(false);
      setForm(null);
      await loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save provider",
      );
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async (provider: ProviderView) => {
    try {
      const res = await fetch(
        `/api/settings/providers/${encodeURIComponent(provider.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to delete provider");
      }
      toast.success(`Removed "${provider.name}"`);
      await loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete provider",
      );
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setTestingId(providerId);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      const result: ConnectionCheckResult = data.provider ?? {
        ok: Boolean(data.ok),
        detail: data.ok ? "Connection passed" : "Connection failed",
      };
      setTestResults((prev) => ({ ...prev, [providerId]: result }));
      if (result.ok) {
        toast.success(result.detail);
      } else {
        toast.error(result.detail);
      }
    } catch {
      toast.error("Connection test request failed");
    } finally {
      setTestingId(null);
    }
  };

  const handlePickDirectory = async () => {
    setPickingDir(true);
    try {
      const res = await fetch("/api/settings/pick-directory", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message ?? "Failed to open folder picker",
        );
      }
      if (!data.cancelled && typeof data.path === "string" && data.path) {
        setAppSettings((prev) => ({ ...prev, projectsDir: data.path }));
        toast.success(`Selected ${data.path}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to open folder picker",
      );
    } finally {
      setPickingDir(false);
    }
  };

  const handleSaveAppSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingApp(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: {
            projectsDir: appSettings.projectsDir.trim() || null,
            maxConcurrentJobs: Math.min(
              16,
              Math.max(1, Math.round(appSettings.maxConcurrentJobs)),
            ),
            jobPollIntervalMs: Math.min(
              120000,
              Math.max(1000, Math.round(appSettings.jobPollIntervalMs)),
            ),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save app settings");
      }
      if (data.app) {
        setAppSettings({
          projectsDir: String(data.app.projectsDir),
          maxConcurrentJobs: Number(data.app.maxConcurrentJobs),
          jobPollIntervalMs: Number(data.app.jobPollIntervalMs),
        });
      }
      toast.success("App settings saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save app settings",
      );
    } finally {
      setSavingApp(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span>Loading provider settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title={
          <>
            Providers &amp; <span className="prism-text">Settings</span>
          </>
        }
        description="Configure API keys, endpoints, and workspace settings directly from the UI. Adding a provider automatically refreshes available models."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAll()}
              className="gap-2"
            >
              <RefreshCw className="size-3.5" />
              <span>Refresh</span>
            </Button>
            <Button size="sm" onClick={openAddDialog} className="gap-1.5">
              <Plus className="size-3.5" />
              <span>Add Provider</span>
            </Button>
          </div>
        }
      />

      <section className="panel space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Configured Providers ({providers.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Keys are stored locally in owner-only{" "}
            <code className="font-mono">data/credentials.json</code> (never in
            SQLite or browser code). After adding providers, select which model
            handles each task in{" "}
            <Link
              href="/settings/models"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Settings → Models
            </Link>
            .
          </p>
        </div>

        {providers.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No providers configured yet"
            description="Click Add Provider to connect QwenCloud, Google Gemini, Groq, or any OpenAI-compatible API."
            className="py-10"
          >
            <Button size="sm" onClick={openAddDialog} className="gap-1.5">
              <Plus className="size-3.5" />
              Add Provider
            </Button>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => {
              const check = testResults[provider.id];
              return (
                <div
                  key={provider.id}
                  className="space-y-3 rounded-xl border border-border bg-surface-2/30 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {provider.name}
                      </span>
                      <Badge variant="secondary">
                        {provider.kind === "qwen"
                          ? "QwenCloud"
                          : provider.kind === "gemini"
                            ? "Gemini SDK"
                            : (provider.preset ?? "openai_compat")}
                      </Badge>
                      {provider.kind === "qwen" && provider.resolvedKeyType && (
                        <Badge variant="outline">
                          {provider.resolvedKeyType}
                        </Badge>
                      )}
                      {provider.kind === "qwen" && provider.region && (
                        <Badge variant="outline">{provider.region}</Badge>
                      )}
                      {!provider.enabled && (
                        <Badge variant="destructive">Disabled</Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={testingId !== null}
                        onClick={() => void handleTestProvider(provider.id)}
                      >
                        {testingId === provider.id && (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        )}
                        Test
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(provider)}
                        className="gap-1"
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${provider.name}`}
                        onClick={() => void handleDeleteProvider(provider)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <dl className="grid gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-subtle-foreground">API Key</dt>
                      <dd className="mt-0.5 font-mono text-foreground">
                        {provider.hasApiKey ? provider.maskedApiKey : "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle-foreground">Endpoint</dt>
                      <dd className="mt-0.5 break-all font-mono text-foreground">
                        {provider.resolvedBaseUrl || "—"}
                      </dd>
                    </div>
                  </dl>

                  {!provider.keyUrlCheck.ok && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <span>
                        Key / URL mismatch: {provider.keyUrlCheck.warning}
                      </span>
                    </div>
                  )}

                  {check && (
                    <div
                      className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                        check.ok
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-destructive/40 bg-destructive/10 text-destructive"
                      }`}
                    >
                      {check.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      )}
                      <span className="min-w-0 break-words">{check.detail}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel space-y-4 p-6">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Workspace &amp; Job Runner Settings
            </h2>
            <p className="text-xs text-muted-foreground">
              Saved locally in{" "}
              <code className="font-mono">data/settings.json</code> and applied
              immediately without restarting the server.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSaveAppSettings}
          className="grid items-end gap-4 sm:grid-cols-4"
        >
          <div className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-foreground">
              Projects Directory
            </span>
            <div className="flex items-center gap-2">
              <div
                title={appSettings.projectsDir}
                className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-border bg-surface-2/40 px-3 font-mono text-xs text-foreground"
              >
                <span className="truncate">{appSettings.projectsDir}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pickingDir}
                onClick={() => void handlePickDirectory()}
                className="h-9 shrink-0 gap-1.5"
              >
                {pickingDir ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="size-3.5" />
                )}
                Choose Folder
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="app-max-concurrent"
              className="text-xs font-medium text-foreground"
            >
              Max Concurrent Jobs
            </label>
            <Input
              id="app-max-concurrent"
              type="number"
              min={1}
              max={16}
              value={appSettings.maxConcurrentJobs}
              onChange={(e) =>
                setAppSettings((prev) => ({
                  ...prev,
                  maxConcurrentJobs: Number(e.target.value) || 1,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="app-poll-ms"
              className="text-xs font-medium text-foreground"
            >
              Poll Interval (ms)
            </label>
            <Input
              id="app-poll-ms"
              type="number"
              min={1000}
              max={120000}
              step={1000}
              value={appSettings.jobPollIntervalMs}
              onChange={(e) =>
                setAppSettings((prev) => ({
                  ...prev,
                  jobPollIntervalMs: Number(e.target.value) || 10000,
                }))
              }
            />
          </div>
          <div className="flex justify-end sm:col-span-4">
            <Button
              type="submit"
              size="sm"
              disabled={savingApp}
              className="gap-1.5"
            >
              {savingApp ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save Settings
            </Button>
          </div>
        </form>
      </section>

      <section className="panel space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">
            Usage, last 7 days
          </span>
          <Badge variant="outline" className="font-mono tabular-nums">
            {(usage?.totals.totalTokens ?? 0).toLocaleString()} tokens
          </Badge>
        </div>
        {usage && usage.byModality.length > 0 ? (
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {usage.byModality.map((row) => (
              <div
                key={row.modality}
                className="rounded-lg border border-border bg-background/40 px-3 py-2"
              >
                <div className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                  {row.modality}
                </div>
                <div className="mt-0.5 font-mono tabular-nums text-foreground">
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
            No usage recorded yet. Syncing models does not spend tokens.
          </p>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setForm(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
            <DialogDescription>
              {form?.id
                ? "Update provider credentials or endpoint. Leave API key blank to keep the saved key."
                : "Select a provider, enter your API key and endpoint, and its available models will sync automatically."}
            </DialogDescription>
          </DialogHeader>

          {form && (
            <form onSubmit={handleSaveProvider} className="space-y-4">
              {!form.id && presets.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Provider
                  </label>
                  <Select
                    value={form.preset}
                    onValueChange={(val) => {
                      const matched = presets.find((p) => p.id === val);
                      if (matched) handleSelectPreset(matched);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {presets.find((p) => p.id === form.preset)?.label ??
                          "Select a provider"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {presets.find((p) => p.id === form.preset)?.description && (
                    <p className="text-[11px] text-muted-foreground">
                      {presets.find((p) => p.id === form.preset)?.description}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="prov-name"
                  className="text-xs font-medium text-foreground"
                >
                  Display Name
                </label>
                <Input
                  id="prov-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev ? { ...prev, name: e.target.value } : prev,
                    )
                  }
                  placeholder="Google Gemini"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="prov-key"
                  className="text-xs font-medium text-foreground"
                >
                  API Key{" "}
                  {form.kind === "openai_compat" && form.preset === "custom"
                    ? "(optional for local servers)"
                    : ""}
                </label>
                <Input
                  id="prov-key"
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            apiKey: e.target.value,
                            clearApiKey: false,
                          }
                        : prev,
                    )
                  }
                  placeholder={
                    form.id
                      ? "Leave blank to keep existing key"
                      : form.kind === "qwen"
                        ? "sk-... or sk-sp-..."
                        : form.kind === "gemini"
                          ? "AQ.... or AIza..."
                          : "gsk_... / sk-..."
                  }
                />
              </div>

              {form.kind === "qwen" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">
                        Key Type
                      </label>
                      <Select
                        value={form.keyType}
                        onValueChange={(val) =>
                          val &&
                          setForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  keyType: val as
                                    | "auto"
                                    | "token_plan"
                                    | "standard",
                                }
                              : prev,
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{form.keyType}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">auto</SelectItem>
                          <SelectItem value="token_plan">token_plan</SelectItem>
                          <SelectItem value="standard">standard</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">
                        Region
                      </label>
                      <Select
                        value={form.region}
                        onValueChange={(val) =>
                          val &&
                          setForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  region: val as
                                    | "ap-southeast-1"
                                    | "cn-beijing",
                                }
                              : prev,
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{form.region}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ap-southeast-1">
                            ap-southeast-1 (International)
                          </SelectItem>
                          <SelectItem value="cn-beijing">
                            cn-beijing (China)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="prov-ws"
                        className="text-xs font-medium text-foreground"
                      >
                        Workspace ID (optional)
                      </label>
                      <Input
                        id="prov-ws"
                        value={form.workspaceId}
                        onChange={(e) =>
                          setForm((prev) =>
                            prev
                              ? { ...prev, workspaceId: e.target.value }
                              : prev,
                          )
                        }
                        placeholder="Optional"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="prov-qwen-url"
                        className="text-xs font-medium text-foreground"
                      >
                        Base URL Override (optional)
                      </label>
                      <Input
                        id="prov-qwen-url"
                        value={form.baseUrl}
                        onChange={(e) =>
                          setForm((prev) =>
                            prev ? { ...prev, baseUrl: e.target.value } : prev,
                          )
                        }
                        placeholder="Auto-resolved from key & region"
                      />
                    </div>
                  </div>
                </>
              ) : form.kind === "gemini" ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="prov-gemini-url"
                    className="text-xs font-medium text-foreground"
                  >
                    Base URL Override (optional)
                  </label>
                  <Input
                    id="prov-gemini-url"
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, baseUrl: e.target.value } : prev,
                      )
                    }
                    placeholder="Leave blank for official Google Gemini API"
                    className="font-mono text-xs"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label
                    htmlFor="prov-url"
                    className="text-xs font-medium text-foreground"
                  >
                    Base URL
                  </label>
                  <Input
                    id="prov-url"
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, baseUrl: e.target.value } : prev,
                      )
                    }
                    placeholder="https://api.groq.com/openai/v1"
                    className="font-mono text-xs"
                  />
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    setForm(null);
                  }}
                  disabled={savingProvider}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={savingProvider}>
                  {savingProvider && (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  )}
                  {form.id ? "Save Changes" : "Add Provider"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
