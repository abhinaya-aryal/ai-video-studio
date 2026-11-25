import { z } from "zod";

/**
 * Per-scene media uploaded from Stage 3. Paths are project-relative
 * (`<slug>/elements/<file>`) or already-resolvable URLs.
 */
export const SceneUploadsSchema = z.object({
  firstFrame: z.string().trim().min(1).optional(),
  lastFrame: z.string().trim().min(1).optional(),
  refImages: z.array(z.string().trim().min(1)).max(10).optional(),
  refVideos: z.array(z.string().trim().min(1)).max(5).optional(),
  refAudios: z.array(z.string().trim().min(1)).max(5).optional(),
});

export type SceneUploadsInput = z.infer<typeof SceneUploadsSchema>;
