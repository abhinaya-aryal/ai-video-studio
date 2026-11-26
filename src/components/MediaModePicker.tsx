"use client";

import { useRef } from "react";
import {
  FileAudio,
  FileVideo,
  ImagePlus,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import type { VideoMode } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MediaType, ModelCapability } from "@/lib/providers/types";
import { mediaModeState } from "@/lib/studio/media-mode";
import { cn } from "@/lib/utils";

export interface UploadedMediaItem {
  filePath: string;
  url: string;
  name: string;
}

interface MediaModePickerProps {
  mode: VideoMode;
  onModeChange: (mode: VideoMode) => void;
  capability: ModelCapability;
  firstFrame: UploadedMediaItem | null;
  lastFrame: UploadedMediaItem | null;
  refImages: UploadedMediaItem[];
  refVideos: UploadedMediaItem[];
  refAudios: UploadedMediaItem[];
  onUpload: (slot: MediaType, files: FileList) => Promise<void>;
  onRemove: (slot: MediaType, index?: number) => void;
  uploadingSlot?: MediaType | null;
}

const MODE_OPTIONS: Array<{ value: VideoMode; label: string }> = [
  { value: "text_to_video", label: "Text to Video" },
  { value: "first_last_frame", label: "First / Last Frame" },
  { value: "omni_reference", label: "Omni-Reference" },
];

interface SlotConfig {
  slot: MediaType;
  label: string;
  accept: string;
  multiple: boolean;
  kind: "image" | "video" | "audio";
  action?: string;
}

const FRAME_SLOTS: SlotConfig[] = [
  {
    slot: "first_frame",
    label: "First Frame",
    accept: "image/*",
    multiple: false,
    kind: "image",
    action: "Add First Frame",
  },
  {
    slot: "last_frame",
    label: "Last Frame",
    accept: "image/*",
    multiple: false,
    kind: "image",
    action: "Add Last Frame",
  },
];

const REFERENCE_SLOTS: SlotConfig[] = [
  {
    slot: "reference_image",
    label: "Reference Images",
    accept: "image/*",
    multiple: true,
    kind: "image",
    action: "Add images",
  },
  {
    slot: "reference_video",
    label: "Reference Videos",
    accept: "video/*",
    multiple: true,
    kind: "video",
    action: "Add video",
  },
  {
    slot: "reference_audio",
    label: "Reference Audio",
    accept: "audio/*",
    multiple: true,
    kind: "audio",
    action: "Add audio",
  },
];

function SlotUploadButton({
  config,
  disabled,
  reason,
  uploading,
  onFiles,
}: {
  config: SlotConfig;
  disabled: boolean;
  reason?: string;
  uploading: boolean;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const btn = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || uploading}
      onClick={() => inputRef.current?.click()}
      className="w-full gap-1.5"
    >
      {uploading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Upload className="size-3.5" />
      )}
      <span>{config.action ?? `Add ${config.label}`}</span>
    </Button>
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={config.accept}
        multiple={config.multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />
      {disabled && reason ? (
        <Tooltip>
          <TooltipTrigger render={<span className="block w-full">{btn}</span>} />
          <TooltipContent className="max-w-xs">{reason}</TooltipContent>
        </Tooltip>
      ) : (
        btn
      )}
    </>
  );
}

export function MediaModePicker({
  mode,
  onModeChange,
  capability,
  firstFrame,
  lastFrame,
  refImages,
  refVideos,
  refAudios,
  onUpload,
  onRemove,
  uploadingSlot,
}: MediaModePickerProps) {
  const state = mediaModeState(mode, capability, {
    firstFrame: Boolean(firstFrame),
    lastFrame: Boolean(lastFrame),
    refImages: refImages.length,
    refVideos: refVideos.length,
    refAudios: refAudios.length,
  });

  const itemsForSlot = (slot: MediaType): UploadedMediaItem[] => {
    switch (slot) {
      case "first_frame":
        return firstFrame ? [firstFrame] : [];
      case "last_frame":
        return lastFrame ? [lastFrame] : [];
      case "reference_image":
        return refImages;
      case "reference_video":
        return refVideos;
      case "reference_audio":
        return refAudios;
      default:
        return [];
    }
  };

  const renderSlot = (config: SlotConfig) => {
    const disabled = state.disabledSlots.includes(config.slot);
    const reason = state.reasons[config.slot];
    const items = itemsForSlot(config.slot);
    const max = capability.maxCounts[config.slot];

    return (
      <div
        key={config.slot}
        className={cn(
          "min-w-0 space-y-2.5 rounded-lg border border-border bg-background/40 p-3 transition-opacity",
          disabled && items.length === 0 && "opacity-60",
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {config.kind === "image" && (
              <ImagePlus className="size-4 shrink-0 text-muted-foreground" />
            )}
            {config.kind === "video" && (
              <FileVideo className="size-4 shrink-0 text-muted-foreground" />
            )}
            {config.kind === "audio" && (
              <FileAudio className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 text-xs leading-snug font-medium">
              {config.label}
            </span>
          </div>
          {typeof max === "number" && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle-foreground">
              {items.length}/{max}
            </span>
          )}
        </div>

        <SlotUploadButton
          config={config}
          disabled={disabled}
          reason={reason}
          uploading={uploadingSlot === config.slot}
          onFiles={(files) => void onUpload(config.slot, files)}
        />

        {items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {items.map((item, idx) => (
              <div
                key={`${item.filePath}-${idx}`}
                className="group relative flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                {config.kind === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="size-8 rounded object-cover"
                  />
                )}
                <span className="max-w-[140px] truncate">
                  {config.slot === "reference_image"
                    ? `@Image ${idx + 1} · ${item.name}`
                    : item.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(config.slot, idx)}
                  aria-label={`Remove ${item.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Generation Mode
        </span>
        <Tabs
          value={mode}
          onValueChange={(next) => onModeChange(next as VideoMode)}
        >
          <TabsList className="rounded-lg">
            {MODE_OPTIONS.map((opt) => (
              <TabsTrigger
                key={opt.value}
                value={opt.value}
                className="rounded-md"
              >
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FRAME_SLOTS.map(renderSlot)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {REFERENCE_SLOTS.map(renderSlot)}
      </div>
    </div>
  );
}
