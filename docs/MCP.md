# X-Ray as an MCP server

`xray mcp` exposes X-Ray's analysis to AI agents (Claude Code, Cursor, any MCP client) over **stdio**. It is read-only: it never modifies the repository, and it indexes into the usual cache (`~/.cache/xray`).

## Setup

Claude Code:

```bash
claude mcp add xray -- node /path/to/xray/packages/cli/src/main.ts mcp
```

Any client that takes a JSON config (Cursor, Claude Desktop, …):

```json
{
  "mcpServers": {
    "xray": { "command": "node", "args": ["/path/to/xray/packages/cli/src/main.ts", "mcp"] }
  }
}
```

Requires Node ≥ 24 (tested on v26.11) and `pnpm install` in the X-Ray checkout.

## Tools

Every tool takes a required `repo` (absolute path to the repository).

| Tool | Purpose |
|---|---|
| `xray_impact` | Impact of a change: working tree, staged, or `base`/`head` range. Returns changed symbols, direct/indirect dependents with evidence, affected Next.js routes, related tests, a suggested test command, and what could not be resolved. |
| `xray_search` | Find symbols/files by name, path or text (symbol + FTS5 + graph retrieval). |
| `xray_node` | One node's details and its neighbours (callers, callees, renders, imports, tests) with evidence. |
| `xray_index` | (Re)index the repository; incremental unless forced. |

Errors are returned as MCP tool results with `isError: true` (not protocol errors), and long output is clipped at 60,000 characters. Output is English.

## Notes

- Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout; nothing else is written to stdout.
- The Ask/AI feature is separate and is not exposed through MCP: the agent *is* the model here.
- Confidence labels (`verified` / `possible` / `unresolved`) are preserved so the agent can tell proven links from approximate ones.
