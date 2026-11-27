"use client";

import Link from "next/link";
import { AlertTriangle, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type RequiredModelTask = "text" | "image" | "video";

export interface ModelsPayloadForCheck {
  selections?: Array<{
    slot: string;
    mode: "auto" | "manual";
    modelId: string | null;
  }>;
  roleProviders?: {
    text_refine?: { providerId: string; modelId?: string };
    text_polish?: { providerId: string; modelId?: string };
    image?: { providerId: string; modelId?: string };
    video?: { providerId: string; modelId?: string };
    audio?: { providerId: string; modelId?: string };
  };
}

const TASK_LABELS: Record<RequiredModelTask, string> = {
  text: "Text (Refine & Polish)",
  image: "Images",
  video: "Video",
};

/**
 * Return the human-readable names of required tasks that do not have an
 * explicit model selected by the user.
 */
export function getMissingExplicitModels(
  data: ModelsPayloadForCheck | null | undefined,
  required: readonly RequiredModelTask[] = ["text", "image", "video"],
): string[] {
  const selections = Array.isArray(data?.selections) ? data.selections : [];
  const roleProviders = data?.roleProviders ?? {};

  const hasManual = (slot: string) =>
    selections.some(
      (s) => s.slot === slot && s.mode === "manual" && Boolean(s.modelId?.trim()),
    );

  const missing: string[] = [];
  for (const task of required) {
    if (task === "text") {
      const hasExternal = Boolean(
        roleProviders.text_polish?.modelId?.trim() ||
          roleProviders.text_refine?.modelId?.trim(),
      );
      const hasQwen = hasManual("text_polish") || hasManual("text_refine");
      if (!hasExternal && !hasQwen) {
        missing.push(TASK_LABELS.text);
      }
    } else if (task === "image") {
      const hasExternal = Boolean(roleProviders.image?.modelId?.trim());
      if (!hasExternal && !hasManual("image")) missing.push(TASK_LABELS.image);
    } else if (task === "video") {
      const hasExternal = Boolean(roleProviders.video?.modelId?.trim());
      if (!hasExternal && !hasManual("video")) missing.push(TASK_LABELS.video);
    }
  }
  return missing;
}

interface ModelSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingTasks: string[];
  actionLabel?: string;
}

export function ModelSetupModal({
  open,
  onOpenChange,
  missingTasks,
  actionLabel = "continue",
}: ModelSetupModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <span>Model setup required</span>
          </DialogTitle>
          <DialogDescription>
            Choose your models explicitly in Settings → Models before you{" "}
            {actionLabel}.
          </DialogDescription>
        </DialogHeader>

        {missingTasks.length > 0 && (
          <div className="space-y-2 rounded-lg border border-warning/35 bg-warning/10 p-3.5 text-xs">
            <p className="font-medium text-warning">
              Models not yet selected:
            </p>
            <ul className="list-disc space-y-1 pl-4 text-foreground/90">
              {missingTasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            render={<Link href="/settings/models" />}
            nativeButton={false}
            className="gap-1.5"
          >
            <Sliders className="size-3.5" />
            Open Settings → Models
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
