import { expect, test } from "bun:test";
import { isToolOf } from "./tools";

test("an MCP server's tools are found by its name as Claude Code writes it in them", () => {
  expect(isToolOf("mcp__claude_ai_GitHub__pick", "claude.ai GitHub")).toBe(true);
  expect(isToolOf("mcp__github__pick", "github")).toBe(true);
  expect(isToolOf("mcp__github__pick", "git")).toBe(false);
  expect(isToolOf("Bash", "github")).toBe(false);
});
