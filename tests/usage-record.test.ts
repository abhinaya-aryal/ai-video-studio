import { describe, expect, it } from "vitest";
import { extractChatUsage } from "@/lib/usage/record";

describe("usage extraction", () => {
  it("reads openai usage fields", () => {
    expect(
      extractChatUsage({
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  });

  it("returns null when usage is absent or malformed", () => {
    expect(extractChatUsage({})).toBeNull();
    expect(extractChatUsage(null)).toBeNull();
    expect(extractChatUsage({ usage: { prompt_tokens: "x" } })).toBeNull();
    expect(extractChatUsage({ usage: { prompt_tokens: 1 } })).toBeNull();
  });
});