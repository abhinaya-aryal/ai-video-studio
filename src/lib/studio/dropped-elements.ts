/**
 * Normalize the `droppedElementsByScene` map returned by batch generation so
 * the UI can surface every element the reference cap removed.
 */
export function collectDroppedElementsByScene(
  raw: unknown,
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, string[]> = {};
  for (const [sceneId, names] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(names)) continue;
    const filtered = names.filter(
      (name): name is string =>
        typeof name === "string" && name.trim().length > 0,
    );
    if (filtered.length > 0) {
      result[sceneId] = filtered;
    }
  }
  return result;
}
