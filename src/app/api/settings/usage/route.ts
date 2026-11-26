import { gte } from "drizzle-orm";
import { getDb, projects, usageEvents } from "@/db";
import { apiOk, handleRouteError } from "@/lib/api/route-helpers";

const RANGE_DAYS = { today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGE_DAYS;

function cutoffFor(range: RangeKey): number {
  const now = new Date();
  if (range === "today") {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
  }
  return Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("range") ?? "today";
    const range: RangeKey =
      requested in RANGE_DAYS ? (requested as RangeKey) : "today";
    const projectId = url.searchParams.get("projectId")?.trim() || null;

    const db = getDb();
    const rows = db
      .select()
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, cutoffFor(range)))
      .all()
      .filter((row) => !projectId || row.projectId === projectId);

    const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const modalityMap = new Map<string, { totalTokens: number; events: number }>();
    const modelMap = new Map<string, { totalTokens: number; events: number }>();
    const projectMap = new Map<string, { totalTokens: number; events: number }>();

    for (const row of rows) {
      const tokens = row.totalTokens ?? 0;
      totals.inputTokens += row.inputTokens ?? 0;
      totals.outputTokens += row.outputTokens ?? 0;
      totals.totalTokens += tokens;

      const modality = modalityMap.get(row.modality) ?? {
        totalTokens: 0,
        events: 0,
      };
      modality.totalTokens += tokens;
      modality.events += 1;
      modalityMap.set(row.modality, modality);

      const model = modelMap.get(row.modelId) ?? { totalTokens: 0, events: 0 };
      model.totalTokens += tokens;
      model.events += 1;
      modelMap.set(row.modelId, model);

      if (row.projectId) {
        const project = projectMap.get(row.projectId) ?? {
          totalTokens: 0,
          events: 0,
        };
        project.totalTokens += tokens;
        project.events += 1;
        projectMap.set(row.projectId, project);
      }
    }

    const titles = new Map(
      db
        .select({ id: projects.id, title: projects.title })
        .from(projects)
        .all()
        .map((project) => [project.id, project.title]),
    );

    return apiOk({
      range,
      totals,
      byModality: [...modalityMap].map(([modality, value]) => ({
        modality,
        ...value,
      })),
      topModels: [...modelMap]
        .map(([modelId, value]) => ({ modelId, ...value }))
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 5),
      byProject: [...projectMap]
        .map(([id, value]) => ({
          projectId: id,
          title: titles.get(id) ?? "Deleted project",
          ...value,
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}