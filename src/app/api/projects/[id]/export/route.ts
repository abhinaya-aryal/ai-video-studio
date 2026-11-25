import {
  apiOk,
  handleRouteError,
  requireProject,
} from "@/lib/api/route-helpers";
import {
  rebuildKdenliveExport,
  streamExportZip,
} from "@/lib/export/kdenlive";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const result = await rebuildKdenliveExport(id);
    return apiOk({ export: result });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = requireProject(id);
    await rebuildKdenliveExport(id);
    const stream = streamExportZip(id);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${project.slug}-kdenlive.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
