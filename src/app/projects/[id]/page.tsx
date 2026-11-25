import { Suspense } from "react";
import { StageTabs } from "@/components/studio/StageTabs";

export const instant = false;

async function ProjectStudioContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StageTabs projectId={id} />;
}

export default function ProjectStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="py-24 text-center text-sm text-muted-foreground">
          Loading project studio...
        </div>
      }
    >
      <ProjectStudioContent params={params} />
    </Suspense>
  );
}
