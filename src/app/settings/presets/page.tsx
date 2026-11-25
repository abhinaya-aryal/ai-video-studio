"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Palette, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { StylePreset } from "@/db/schema";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function StylePresetsPage() {
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [loading, setLoading] = useState(true);

  const [presetName, setPresetName] = useState("");
  const [presetStyleBible, setPresetStyleBible] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/presets", { cache: "no-store" });
      const data = await res.json();
      setPresets(Array.isArray(data.presets) ? data.presets : []);
    } catch {
      toast.error("Failed to load style presets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/presets", { cache: "no-store" });
        const data = await res.json();
        if (active) {
          setPresets(Array.isArray(data.presets) ? data.presets : []);
        }
      } catch {
        if (active) toast.error("Failed to load style presets");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
      await loadPresets();
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
      await loadPresets();
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
        <span>Loading style presets...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title={
          <>
            Style <span className="prism-text">Presets</span>
          </>
        }
        description="Reusable visual style bibles available when creating projects."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadPresets()}
            className="gap-2"
          >
            <RefreshCw className="size-3.5" />
            <span>Refresh</span>
          </Button>
        }
      />

      <section className="panel space-y-5 p-6">
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
          <EmptyState
            icon={Palette}
            title="No style presets configured yet"
            description="Create a reusable Style Bible above to quickly apply consistent visual direction to new projects."
            className="border-dashed bg-surface-2/20 py-8 shadow-none"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="panel-glow flex flex-col justify-between gap-2.5 rounded-xl border border-border bg-surface-2/30 p-4"
              >
                <div className="relative z-10 min-w-0 space-y-1.5">
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
                  <div className="relative z-10 flex justify-end border-t border-border pt-2">
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
  );
}
