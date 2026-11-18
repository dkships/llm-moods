import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyBatchTargeted, type OpenAiPromptLayout } from "../../supabase/functions/_shared/classifier";

const MODEL = "gpt-6.2-sol";
const ITEMS = [{ text: "Codex fixed my build in one go", targetModel: "ChatGPT" }];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface ChatMessage {
  role: string;
  content: string;
}

// Runs one production batch against a stub and returns the messages it sent.
async function sentMessages(layout?: OpenAiPromptLayout): Promise<ChatMessage[]> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: { message: "capture" } }), { status: 400 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await classifyBatchTargeted(ITEMS, "openai-key", 20, undefined, { model: MODEL, promptLayout: layout });

  const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
  return body.messages;
}

// GPT-5.6+ caches up to the end of a message, so the static instructions only
// cache when they are a message of their own.
describe("OpenAI prompt layout", () => {
  it("keeps one user message by default", async () => {
    const messages = await sentMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("Post 1 [TARGET: ChatGPT]");
  });

  it.each([
    ["two_user", "user"],
    ["developer", "developer"],
  ] as const)("puts the instructions in their own %s message", async (layout, role) => {
    const single = await sentMessages("single");
    const split = await sentMessages(layout);

    expect(split.map((m) => m.role)).toEqual([role, "user"]);
    expect(split[0].content).not.toContain("Post 1 [TARGET:");
    expect(split[1].content.startsWith("Post 1 [TARGET: ChatGPT]")).toBe(true);

    // Same text overall: only the message boundary moves.
    expect(split[0].content + split[1].content).toBe(single[0].content);
  });
});
