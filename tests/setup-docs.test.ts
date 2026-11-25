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

  it("documents every environment key with a README table row", () => {
    const configSource = readRootFile("src/lib/config.ts");
    const readme = readRootFile("README.md");

    const referencedEnvKeys = new Set(
      Array.from(configSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)).map(
        (match) => match[1],
      ),
    );

    expect(readme).toContain(
      "| Variable | Required | Default | Accepted values | Purpose |",
    );
    const rows = readme
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("| `"));

    for (const key of referencedEnvKeys) {
      expect(
        rows.some((row) => row.trim().startsWith(`| \`${key}\` |`)),
        `README is missing a table row for ${key}`,
      ).toBe(true);
    }
  });

  it("documents built-in model options and where to find newer models", () => {
    const readme = readRootFile("README.md");

    for (const modelId of [
      "wan3.0-video",
      "wan3.0-video-prime",
      "wan2.7-t2v",
      "wan2.7-i2v",
      "wan2.7-r2v",
      "wan2.7-image-pro",
      "wan2.7-image",
      "qwen-image-3.0",
      "qwen-audio-3.0-tts-plus",
      "qwen-plus",
      "qwen-max",
      "qwen-turbo",
    ]) {
      expect(readme).toContain(modelId);
    }

    for (const family of ["wan3", "wan2.7", "qwen-image", "qwen-tts"]) {
      expect(readme).toContain(family);
    }

    for (const url of [
      "https://www.alibabacloud.com/help/en/model-studio/models",
      "https://www.alibabacloud.com/help/en/model-studio/newly-released-models",
      "https://www.alibabacloud.com/help/en/model-studio/wan3-0-video",
      "https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference",
      "https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/market",
    ]) {
      expect(readme).toContain(url);
    }

    expect(readme).toContain("Settings → Custom Models");
    expect(readme).toContain("src/lib/providers/catalog.ts");
  });
});
