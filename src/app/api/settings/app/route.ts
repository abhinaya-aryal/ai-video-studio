import { z } from "zod";
import {
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import {
  RoleProviderBindingSchema,
  updateAppAndRoleSettings,
} from "@/lib/settings/store";

const UpdateAppSettingsSchema = z.object({
  app: z
    .object({
      projectsDir: z.string().trim().min(1).nullable().optional(),
      maxConcurrentJobs: z.number().int().min(1).max(16).nullable().optional(),
      jobPollIntervalMs: z
        .number()
        .int()
        .min(1000)
        .max(120000)
        .nullable()
        .optional(),
    })
    .optional(),
  roleProviders: z
    .object({
      text_refine: RoleProviderBindingSchema.nullable().optional(),
      text_polish: RoleProviderBindingSchema.nullable().optional(),
      image: RoleProviderBindingSchema.nullable().optional(),
      video: RoleProviderBindingSchema.nullable().optional(),
      audio: RoleProviderBindingSchema.nullable().optional(),
    })
    .optional(),
});

export async function PUT(req: Request) {
  try {
    const input = await parseJsonBody(req, UpdateAppSettingsSchema);
    const cfg = getConfig();
    const updated = updateAppAndRoleSettings(cfg.dataDir, input);
    const refreshed = getConfig();

    return apiOk({
      app: {
        projectsDir: updated.app.projectsDir ?? refreshed.projectsDir,
        maxConcurrentJobs: refreshed.jobs.maxConcurrent,
        jobPollIntervalMs: refreshed.jobs.pollIntervalMs,
      },
      roleProviders: updated.roleProviders,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
