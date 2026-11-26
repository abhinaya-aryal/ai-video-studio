import { eq } from "drizzle-orm";
import {
  AUTO_PRESETS,
  MODEL_SLOTS,
  customModels,
  modelPreferences,
  modelSelections,
  type AutoPreset,
  type CustomModel,
  type ModelSlot,
} from "@/db/schema";
import type { DrizzleDb } from "@/db";
import { getModelCapabilities } from "@/lib/providers/catalog";
import { inferCapabilities } from "@/lib/providers/model-inference";
import type { ModelCapability, ModelModality } from "@/lib/providers/types";

export type CostTier = "high" | "mid" | "low";
export type ModelSelectionErrorCode =
  | "MODEL_NOT_SELECTED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_UNSUPPORTED";

export class ModelSelectionError extends Error {
  readonly code: ModelSelectionErrorCode;
  readonly slot: ModelSlot;
  readonly status: number;

  constructor(
    code: ModelSelectionErrorCode,
    slot: ModelSlot,
    message: string,
  ) {
    super(message);
    this.name = "ModelSelectionError";
    this.code = code;
    this.slot = slot;
    this.status = code === "MODEL_UNSUPPORTED" ? 422 : 409;
  }
}

export interface ResolvedModel {
  modelId: string;
  source: "manual" | "auto";
  reason: string;
}

export interface ResolvedSlot {
  slot: ModelSlot;
  modelId: string | null;
  source: "manual" | "auto" | "none";
  reason: string;
}

const HIGH_TIER = /(prime|max|pro|-r2v)/i;
const LOW_TIER = /(flash|turbo|air)/i;

const TIER_OVERRIDES: Record<string, CostTier> = {
  "wan3.0-video": "high",
  "wan2.7-image-pro": "mid",
  "qwen-audio-3.0-tts-plus": "high",
};

/** Relative cost tier inferred from the model ID. The endpoint exposes no prices. */
export function costTier(modelId: string): CostTier {
  return (
    TIER_OVERRIDES[modelId] ??
    (HIGH_TIER.test(modelId) ? "high" : LOW_TIER.test(modelId) ? "low" : "mid")
  );
}

const PRESET_TIERS: Record<ModelSlot, Record<AutoPreset, CostTier[]>> = {
  text_refine: {
    quality: ["high"],
    balanced: ["mid", "high"],
    economy: ["low", "mid"],
  },
  text_polish: {
    quality: ["high"],
    balanced: ["low", "mid"],
    economy: ["low", "mid"],
  },
  image: {
    quality: ["high"],
    balanced: ["mid", "high"],
    economy: ["low", "mid"],
  },
  video: {
    quality: ["high"],
    balanced: ["mid", "high", "low"],
    economy: ["low", "mid", "high"],
  },
  audio: {
    quality: ["high"],
    balanced: ["high", "mid", "low"],
    economy: ["high", "mid", "low"],
  },
};

/** Modality a role consumes. */
export function slotModality(slot: ModelSlot): ModelModality {
  if (slot === "text_refine" || slot === "text_polish") return "text";
  return slot;
}

function capabilityFor(
  row: CustomModel,
  rows: CustomModel[],
): ModelCapability {
  try {
    return getModelCapabilities(row.modelId, rows);
  } catch {
    return inferCapabilities(row.modelId);
  }
}

function fitsSlot(row: CustomModel, rows: CustomModel[], slot: ModelSlot): boolean {
  if (row.modality !== slotModality(slot)) return false;
  if (slot === "audio") {
    return capabilityFor(row, rows).ttsCapable !== false;
  }
  return true;
}

function isSelectable(row: CustomModel): boolean {
  return row.available === 1 && row.ignored === 0;
}

export function getAutoPreset(db: DrizzleDb): AutoPreset {
  const row = db
    .select()
    .from(modelPreferences)
    .where(eq(modelPreferences.id, 1))
    .get();
  if (row && (AUTO_PRESETS as readonly string[]).includes(row.autoPreset)) {
    return row.autoPreset;
  }
  return "balanced";
}

export function setAutoPreset(db: DrizzleDb, preset: AutoPreset): void {
  const updatedAt = Date.now();
  db.insert(modelPreferences)
    .values({ id: 1, autoPreset: preset, updatedAt })
    .onConflictDoUpdate({
      target: modelPreferences.id,
      set: { autoPreset: preset, updatedAt },
    })
    .run();
}

/**
 * Pick the model Auto would choose for a role. Throws when the registry has
 * no selectable model of the right modality.
 */
export function pickAutoModel(
  rows: CustomModel[],
  slot: ModelSlot,
  preset: AutoPreset,
): string {
  const selectable = rows.filter(
    (row) => isSelectable(row) && fitsSlot(row, rows, slot),
  );
  // The provider's "auto" router is a meta-model. Keep it selectable manually
  // but prefer concrete models when Auto chooses.
  const concrete = selectable.filter(
    (row) => row.modelId.toLowerCase() !== "auto",
  );
  const candidates = concrete.length > 0 ? concrete : selectable;

  if (candidates.length === 0) {
    throw new ModelSelectionError(
      "MODEL_NOT_SELECTED",
      slot,
      `No available ${slotModality(slot)} model can serve ${slot}. Sync models or add one in Settings.`,
    );
  }

  for (const tier of PRESET_TIERS[slot][preset]) {
    const tiered = candidates.filter((row) => costTier(row.modelId) === tier);
    if (tiered.length > 0) {
      tiered.sort(
        (a, b) =>
          (b.providerCreatedAt ?? 0) - (a.providerCreatedAt ?? 0) ||
          b.modelId.localeCompare(a.modelId),
      );
      return tiered[0].modelId;
    }
  }

  return candidates
    .slice()
    .sort((a, b) => (b.providerCreatedAt ?? 0) - (a.providerCreatedAt ?? 0))[0]
    .modelId;
}

function requireSelectable(
  rows: CustomModel[],
  slot: ModelSlot,
  modelId: string,
): CustomModel {
  const row = rows.find((candidate) => candidate.modelId === modelId);
  if (!row || !isSelectable(row)) {
    throw new ModelSelectionError(
      "MODEL_UNAVAILABLE",
      slot,
      `Model "${modelId}" is not available to this token. Pick another model in Settings.`,
    );
  }
  if (!fitsSlot(row, rows, slot)) {
    throw new ModelSelectionError(
      "MODEL_UNSUPPORTED",
      slot,
      `Model "${modelId}" cannot serve the ${slot} role.`,
    );
  }
  return row;
}

/** Validate that a model row exists, is selectable, and fits the role. */
export function assertModelForSlot(
  db: DrizzleDb,
  slot: ModelSlot,
  modelId: string,
): void {
  const rows = db.select().from(customModels).all();
  requireSelectable(rows, slot, modelId);
}

export interface ResolveSlotOptions {
  explicitModelId?: string | null;
  projectModelId?: string | null;
}

/**
 * Resolve a role to a concrete model. Order: explicit, project override
 * (video only), saved selection. Never falls back to a constant.
 */
export function resolveSlotModel(
  db: DrizzleDb,
  slot: ModelSlot,
  options: ResolveSlotOptions = {},
): ResolvedModel {
  const rows = db.select().from(customModels).all();

  const explicit = options.explicitModelId?.trim();
  if (explicit) {
    requireSelectable(rows, slot, explicit);
    return { modelId: explicit, source: "manual", reason: "Explicit request model" };
  }

  const projectModel = options.projectModelId?.trim();
  if (slot === "video" && projectModel) {
    requireSelectable(rows, slot, projectModel);
    return { modelId: projectModel, source: "manual", reason: "Project override" };
  }

  const selection = db
    .select()
    .from(modelSelections)
    .where(eq(modelSelections.slot, slot))
    .get();

  if (!selection) {
    throw new ModelSelectionError(
      "MODEL_NOT_SELECTED",
      slot,
      `No ${slot} model is selected. Open Settings → Models and choose one.`,
    );
  }

  if (selection.mode === "manual") {
    const modelId = selection.modelId?.trim();
    if (!modelId) {
      throw new ModelSelectionError(
        "MODEL_NOT_SELECTED",
        slot,
        `The ${slot} role is set to manual but has no model. Choose one in Settings.`,
      );
    }
    requireSelectable(rows, slot, modelId);
    return { modelId, source: "manual", reason: "Saved selection" };
  }

  const preset = getAutoPreset(db);
  const modelId = pickAutoModel(rows, slot, preset);
  return {
    modelId,
    source: "auto",
    reason: `${preset === "balanced" ? "Balanced" : preset === "quality" ? "Quality" : "Economy"} Auto: ${costTier(modelId)} tier`,
  };
}

/** Resolve every role without throwing, for dashboards and settings. */
export function resolveAllSlots(db: DrizzleDb): ResolvedSlot[] {
  return MODEL_SLOTS.map((slot) => {
    try {
      const resolved = resolveSlotModel(db, slot);
      return { slot, ...resolved };
    } catch (err) {
      return {
        slot,
        modelId: null,
        source: "none" as const,
        reason: err instanceof Error ? err.message : "No model selected",
      };
    }
  });
}