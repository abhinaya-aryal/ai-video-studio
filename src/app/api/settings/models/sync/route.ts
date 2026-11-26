import { apiOk, handleRouteError } from "@/lib/api/route-helpers";
import { syncProviderModels } from "@/lib/providers/model-sync";

export async function POST() {
  try {
    const result = await syncProviderModels();
    return apiOk(result);
  } catch (err) {
    return handleRouteError(err);
  }
}