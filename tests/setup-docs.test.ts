import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRootFile(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("day-1 documentation and repository setup", () => {
  it("includes README.md, AGENTS.md, and CLAUDE.md importing AGENTS.md", () => {
    expect(existsSync(path.join(ROOT, "README.md"))).toBe(true);
    expect(existsSync(path.join(ROOT, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(ROOT, "CLAUDE.md"))).toBe(true);

    const claudeMd = readRootFile("CLAUDE.md");
    expect(claudeMd).toContain("@AGENTS.md");
  });

  it("configures .gemini/settings.json to load AGENTS.md", () => {
    const raw = readRootFile(".gemini/settings.json");
    const parsed = JSON.parse(raw) as {
      context?: { fileName?: string[] };
    };

    expect(Array.isArray(parsed.context?.fileName)).toBe(true);
    expect(parsed.context?.fileName).toContain("AGENTS.md");
  });

  it("ignores local env, runtime data, projects, and .superpowers in .gitignore", () => {
    const gitignore = readRootFile(".gitignore");
    const lines = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(lines).toContain(".env");
    expect(lines).toContain(".env.local");
    expect(lines).toContain("/data/");
    expect(lines).toContain("/projects/");
    expect(lines).toContain(".superpowers/");
  });

  it("documents every process.env key referenced in src/lib/config.ts inside .env.example", () => {
    const configSource = readRootFile("src/lib/config.ts");
    const envExample = readRootFile(".env.example");

    const referencedEnvKeys = new Set(
      Array.from(configSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)).map(
        (match) => match[1],
      ),
    );

    expect(referencedEnvKeys.size).toBeGreaterThan(0);

    const exampleKeys = new Set(
      envExample
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split("=")[0]?.trim())
        .filter(Boolean),
    );

    for (const key of referencedEnvKeys) {
      expect(exampleKeys.has(key)).toBe(true);
    }
  });
});
