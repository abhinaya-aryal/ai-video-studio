import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES } from "@/lib/theme";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

describe("nebula theme foundation", () => {
  it("registers nebula as the only default theme", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(["nebula"]);
    expect(DEFAULT_THEME).toBe("nebula");
    expect(THEMES[0]).toMatchObject({ label: "Nebula", scheme: "dark" });
  });

  it("defines nebula tokens in one theme block", () => {
    const css = read("src/styles/theme.css");
    expect(css).toContain('[data-theme="nebula"]');
    for (const token of [
      "--background:",
      "--card:",
      "--primary:",
      "--primary-2:",
      "--primary-3:",
      "--warning:",
      "--success:",
      "--info:",
      "--border:",
      "--radius:",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("has no dark-mode class variants or block", () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(relative);
        return /\.(tsx|css)$/.test(entry.name) ? [relative] : [];
      });

    for (const file of walk("src")) {
      expect(read(file)).not.toContain("dark:");
    }
    const globals = read("src/app/globals.css");
    expect(globals).not.toContain("@custom-variant dark");
    expect(globals).not.toMatch(/^\.dark\s*\{/m);
  });

  it("sets the default theme on the html element", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("data-theme={DEFAULT_THEME}");
    expect(layout).not.toContain('className="dark');
  });

  it("uses semantic status tokens instead of raw palette colors", () => {
    const roots = ["src/app", "src/components"];
    const offenders: string[] = [];

    const walk = (dir: string): string[] => {
      const entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
      return entries.flatMap((entry) => {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(relative);
        return entry.name.endsWith(".tsx") ? [relative] : [];
      });
    };

    for (const file of roots.flatMap(walk)) {
      if (/(?:amber|blue|emerald|red|green|zinc|indigo|slate)-\d{2,3}/.test(read(file))) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
