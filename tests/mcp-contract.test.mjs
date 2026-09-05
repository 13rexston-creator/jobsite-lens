import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../app/mcp/[token]/route.ts", import.meta.url);

test("private ChatGPT MCP route preserves the read-only knowledge-source contract", async () => {
  const source = await readFile(routePath, "utf8");

  assert.match(source, /createMcpHandler/);
  assert.match(source, /resolveChatGPTConnection\(token\)/);
  assert.match(source, /readOnlyHint:\s*true/);
  assert.match(source, /destructiveHint:\s*false/);
  assert.match(source, /openWorldHint:\s*false/);
  assert.match(source, /idempotentHint:\s*true/);

  for (const tool of ["search", "fetch", "list_plan_projects", "view_plan_page", "get_fixture_takeoff"]) {
    assert.match(source, new RegExp(`registerTool\\("${tool}"`));
  }

  assert.match(source, /const searchOutputSchema = z\.object\(\{[\s\S]*?results:[\s\S]*?id:[\s\S]*?title:[\s\S]*?url:/);
  assert.match(source, /const fetchOutputSchema = z\.object\(\{[\s\S]*?id:[\s\S]*?title:[\s\S]*?text:[\s\S]*?url:[\s\S]*?metadata:/);
  assert.match(source, /content:\s*\[\{ type: "text" as const, text: JSON\.stringify\(value\) \}\]/);
  assert.match(source, /type:\s*"image" as const, data: base64Jpeg\(bytes\), mimeType:\s*"image\/jpeg"/);
  assert.match(source, /priorityCandidatePages/);
  assert.match(source, /priorityCompletePages/);
  assert.match(source, /priorityRemainingPages/);
  assert.match(source, /there is no background analysis job/);
  assert.doesNotMatch(source, /openAIRequest|OPENAI_API_KEY|console\.(?:log|error|warn)/);
});
