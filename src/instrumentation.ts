/**
 * Next.js server startup hook: re-adopts any non-terminal jobs in SQLite and
 * starts the background job runner polling loop on the Node.js runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getRunner } = await import("@/lib/jobs/runner");
    const runner = getRunner();
    runner.resume();
    runner.start();
  }
}
