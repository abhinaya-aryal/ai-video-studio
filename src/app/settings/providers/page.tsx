"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { QwenKeyUrlCheck } from "@/lib/providers/qwen-endpoints";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

export default function ProviderStatusPage() {
  const [status, setStatus] = useState<SettingsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingTarget, setTestingTarget] = useState<
    "qwen" | "openai_compat" | "all" | null
  >(null);
  const [testResults, setTestResults] = useState<{
    qwen?: ConnectionCheckResult;
    openaiCompat?: ConnectionCheckResult;
  }>({});

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/status", { cache: "no-store" });
      const data = await res.json();
      setStatus(data);
    } catch {
      toast.error("Failed to load provider status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/status", { cache: "no-store" });
        const data = await res.json();
        if (active) setStatus(data);
      } catch {
        if (active) toast.error("Failed to load provider status");
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span>Loading provider status...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title={
          <>
            Provider <span className="prism-text">Status</span>
          </>
        }
        description="Read-only view of server environment configuration (keys masked) and live connectivity checks."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStatus()}
            className="gap-2"
          >
            <RefreshCw className="size-3.5" />
            <span>Refresh</span>
          </Button>
        }
      />

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
            (standard <code className="font-mono">sk-...</code> or Token Plan{" "}
            <code className="font-mono">sk-sp-...</code>),{" "}
            <code className="font-mono text-foreground">QWEN_KEY_TYPE</code>,
            and <code className="font-mono text-foreground">QWEN_REGION</code>{" "}
            to <code className="font-mono text-foreground">.env.local</code>,
            then restart <code className="font-mono">bun run dev</code>.
          </p>
        </section>
      )}

      <section className="panel space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Endpoints &amp; Keys
            </h2>
            <p className="text-xs text-muted-foreground">
              Verify QwenCloud / DashScope and OpenAI-compatible text refiner
              connectivity.
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
                  <dt className="text-subtle-foreground">Resolved Base URL</dt>
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
                Using Qwen text model via DashScope compatible-mode endpoint.
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
    </div>
  );
}
