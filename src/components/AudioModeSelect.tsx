"use client";

import type { AudioMode } from "@/db/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AudioModeSelectProps {
  value: AudioMode;
  onChange: (value: AudioMode) => void;
  disabled?: boolean;
  nativeAudioSupported?: boolean;
  id?: string;
}

const AUDIO_MODE_OPTIONS: Array<{
  value: AudioMode;
  label: string;
  description: string;
}> = [
  {
    value: "ambient_only",
    label: "Ambient Only",
    description: "Soundscape & SFX, no speech",
  },
  {
    value: "narration",
    label: "Narration",
    description: "Voiceover narration",
  },
  {
    value: "dialogue",
    label: "Dialogue",
    description: "Character dialogue",
  },
  {
    value: "silent",
    label: "Silent",
    description: "No generated audio",
  },
];

export function AudioModeSelect({
  value,
  onChange,
  disabled,
  nativeAudioSupported = true,
  id,
}: AudioModeSelectProps) {
  const selected = AUDIO_MODE_OPTIONS.find((opt) => opt.value === value);

  return (
    <div className="space-y-1">
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as AudioMode);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Select audio mode">
            {selected ? selected.label : "Select audio mode"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {AUDIO_MODE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div className="flex flex-col text-left">
                <span>{opt.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {opt.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!nativeAudioSupported && (
        <p className="text-[11px] text-amber-400">
          Selected model does not support native audio; silent output only.
        </p>
      )}
    </div>
  );
}
