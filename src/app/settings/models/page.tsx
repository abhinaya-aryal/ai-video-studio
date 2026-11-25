"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CustomModel, CustomModelModality } from "@/db/schema";
import { EmptyState } from "@/components/EmptyState";
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

const MODALITIES: CustomModelModality[] = ["video", "image", "audio", "text"];
const FAMILIES = ["wan3", "wan2.7", "qwen-image", "qwen-tts", "text"];

export default function CustomModelsPage() {
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [loading, setLoading] = useState(true);

  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [modality, setModality] = useState<CustomModelModality>("video");
  const [family, setFamily] = useState("wan3");
  const [savingModel, setSavingModel] = useState(false);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/models", { cache: "no-store" });
      const data = await res.json();
      setCustomModels(
        Array.isArray(data.customModels) ? data.customModels : [],
      );
    } catch {
      toast.error("Failed to load custom models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/models", { cache: "no-store" });
        const data = await res.json();
        if (active) {
          setCustomModels(
            Array.isArray(data.customModels) ? data.customModels : [],
          );
        }
      } catch {
        if (active) toast.error("Failed to load custom models");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
      await loadModels();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete model",
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span>Loading custom models...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title={
          <>
            Custom <span className="prism-text">Models</span>
          </>
        }
        description="Register new DashScope / Wan model IDs so they appear in model pickers without code edits."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadModels()}
            className="gap-2"
          >
            <RefreshCw className="size-3.5" />
            <span>Refresh</span>
          </Button>
        }
      />

      <section className="panel space-y-5 p-6">
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

        {customModels.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No custom models registered yet"
            description="Register a DashScope or Wan model ID above to make it selectable across projects and Quick Clip."
            className="border-dashed bg-surface-2/20 py-8 shadow-none"
          />
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface-2/30">
            {customModels.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
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
    </div>
  );
}
