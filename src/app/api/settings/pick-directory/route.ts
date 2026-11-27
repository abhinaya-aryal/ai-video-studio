import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { apiOk, handleRouteError, RouteError } from "@/lib/api/route-helpers";

const execFileAsync = promisify(execFile);

/**
 * Open a native OS directory picker dialog on the local machine and return the
 * selected absolute path. Since this app is local-first, running the native
 * dialog server-side provides the exact filesystem path that browser file
 * inputs cannot expose.
 */
export async function POST() {
  try {
    const platform = process.platform;

    if (platform === "darwin") {
      try {
        const { stdout } = await execFileAsync("osascript", [
          "-e",
          'POSIX path of (choose folder with prompt "Select Projects Directory")',
        ]);
        const selected = stdout.trim().replace(/\/+$/, "") || "/";
        return apiOk({ path: selected, cancelled: false });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("-128") || msg.toLowerCase().includes("cancel")) {
          return apiOk({ path: null, cancelled: true });
        }
        throw new RouteError(
          "PICKER_FAILED",
          "Unable to open macOS folder picker.",
          500,
        );
      }
    }

    if (platform === "linux") {
      try {
        const { stdout } = await execFileAsync("zenity", [
          "--file-selection",
          "--directory",
          "--title=Select Projects Directory",
        ]);
        const selected = stdout.trim().replace(/\/+$/, "") || "/";
        return apiOk({ path: selected, cancelled: false });
      } catch (err) {
        const code = (err as { code?: number })?.code;
        if (code === 1) {
          return apiOk({ path: null, cancelled: true });
        }
        throw new RouteError(
          "PICKER_FAILED",
          "Folder picker requires zenity on Linux.",
          501,
        );
      }
    }

    if (platform === "win32") {
      try {
        const script = [
          "Add-Type -AssemblyName System.Windows.Forms;",
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog;",
          "$d.Description = 'Select Projects Directory';",
          "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
        ].join(" ");
        const { stdout } = await execFileAsync("powershell", [
          "-NoProfile",
          "-Command",
          script,
        ]);
        const selected = stdout.trim();
        if (!selected) {
          return apiOk({ path: null, cancelled: true });
        }
        return apiOk({ path: selected, cancelled: false });
      } catch {
        throw new RouteError(
          "PICKER_FAILED",
          "Unable to open Windows folder picker.",
          500,
        );
      }
    }

    throw new RouteError(
      "UNSUPPORTED_PLATFORM",
      "Native folder picker is not supported on this platform.",
      501,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
