# Contributing to obsidian-vaultgate-mcp

Thank you for your interest in contributing. This document covers the project
architecture, development workflow, and conventions for adding or changing tools.

---

## Table of Contents

- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Architecture overview](#architecture-overview)
  - [Transport detection](#transport-detection)
  - [HTTP routing](#http-routing)
  - [CLI invocation](#cli-invocation)
  - [dryRun consent mechanism](#dryrun-consent-mechanism)
- [Adding a new tool](#adding-a-new-tool)
- [Testing](#testing)
  - [Running tests](#running-tests)
  - [Test structure](#test-structure)
  - [Writing unit tests for a tool](#writing-unit-tests-for-a-tool)
  - [Mocking the CLI](#mocking-the-cli)
  - [Coverage thresholds](#coverage-thresholds)
- [Code style](#code-style)
- [Pull request checklist](#pull-request-checklist)

---

## Development setup

```bash
git clone https://github.com/mkemeter/obsidian-vaultgate-mcp.git
cd obsidian-vaultgate-mcp
npm install
npm run build   # compiles TypeScript → build/
npm test        # run the full test suite
```

### Development scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript → `build/` |
| `npm test` | Run full test suite |
| `npm run test:coverage` | Tests + coverage report |
| `npm run check` | Biome lint + format check (CI-equivalent) |
| `npm run lint:fix` | Auto-fix Biome lint violations |
| `npm run format` | Auto-format source files |
| `npm run typecheck` | Type-check without building |
| `npm run knip` | Dead-code check locally |

The `npm` commands work identically on macOS, Linux, and Windows (PowerShell or
cmd). Use the shell you are comfortable with.

You do **not** need Obsidian installed to develop or run tests — the test suite
mocks the CLI binary entirely.

---

## Project structure

```
src/
├── index.ts          Entry point — detects stdio vs HTTP mode, starts transport
├── server.ts         Creates McpServer and registers all tool groups
├── config.ts         Loads env vars (OBSIDIAN_VAULT, OBSIDIAN_CLI_PATH, OBSIDIAN_MCP_PORT)
├── cli.ts            runObsidian() — the single point of contact with the CLI binary
├── health.ts         Startup check — verifies the binary is reachable before serving
├── uri.ts            openUri() / runUri() — OS-level URI dispatch (obsidian:// links)
└── tools/
    ├── _helpers.ts   Shared utilities: dryRunPreview(), buildFileArgs()
    ├── files.ts      files_list, files_read, note_create, note_append,
    │                 note_prepend, note_update, note_trash
    ├── search.ts     search
    ├── daily.ts      daily_read, daily_append
    ├── tasks.ts      tasks_all, tasks_pending, tasks_daily
    ├── templates.ts  templates_list, templates_apply
    ├── properties.ts property_read, property_set
    ├── tags.ts       tags, backlinks, unresolved
    ├── plugins.ts    plugins_list, plugin_reload
    ├── dev.ts        eval, dev_errors, dev_console, dev_css, dev_dom,
    │                 dev_screenshot, dev_mobile
    ├── context.ts    vault_context, vault_context_set
    ├── uri.ts        note_open, search_open, daily_open
    └── semantic.ts   semantic_search, find_similar, index_vault,
                      clear_index, vault_info  (optional — requires @xenova/transformers)

tests/
├── unit/
│   ├── cli.test.ts
│   ├── config.test.ts
│   ├── health.test.ts
│   └── tools/        one file per tool group, mirrors src/tools/
└── integration/
    ├── http.test.ts   real HTTP server, origin validation, endpoint smoke tests
    └── server.test.ts tool registration count, all tools have names/descriptions
```

---

## Architecture overview

### Transport detection

`src/index.ts` decides the run mode at startup by inspecting `process.stdin.isTTY`:

```
stdin is a pipe (not a TTY)  →  stdio mode   (used by Claude Code)
stdin is a TTY               →  HTTP mode    (used by any URL-based MCP client)
```

In **stdio mode** the process communicates over stdin/stdout using
`StdioServerTransport`. Claude Code manages the process lifecycle.

In **HTTP mode** a Node.js HTTP server listens on `127.0.0.1:<PORT>` (default
`3001`). Two MCP transports are served simultaneously for compatibility:

| Route | Transport |
|-------|-----------|
| `POST /mcp` | Streamable HTTP — modern MCP spec (2025-03-26) |
| `GET /sse` | SSE — legacy transport, backward-compatible fallback |
| `POST /messages?sessionId=X` | SSE message delivery to an existing session |
| `GET /health` | Liveness probe — returns `200 OK` |

### HTTP routing

Each incoming HTTP request goes through:

1. **Origin check** (`isAllowedOrigin`) — rejects requests whose `Origin`
   header is not `localhost` or `127.0.0.1`. This is the DNS rebinding
   protection layer. Requests with no `Origin` (e.g. CLI `curl`) are allowed.

2. **CORS headers** — set on responses when a recognised `Origin` is present.

3. **Route dispatch** — matched on `(method, pathname)`.

SSE sessions are held in a `Map<sessionId, SSEServerTransport>` for the
lifetime of the HTTP server. Each `GET /sse` creates a new entry; the entry is
deleted when the response closes.

Streamable HTTP creates a fresh `McpServer` + `StreamableHTTPServerTransport`
pair per request — the stateless design recommended by the MCP spec.

### CLI invocation

**All communication with Obsidian goes through `runObsidian()` in `src/cli.ts`.**

```typescript
runObsidian(["files", "list", "limit=20"])
// → execFile("obsidian", ["vault=My Vault", "files", "list", "limit=20"])
```

Key design decisions:

- **`execFile` not `exec`** — arguments are passed as an array and are never
  interpreted by a shell. Note names and content with shell metacharacters are
  safe.
- **Vault prefix** — when `OBSIDIAN_VAULT` is set, `vault=<name>` is
  prepended automatically so callers never need to think about it.
- **Timeout** — 30 seconds. Long enough for Obsidian to auto-start if it was
  not running; short enough to surface hangs quickly.
- **Max buffer** — 10 MB, sufficient for large vault listings or long notes.
- **ENOENT handling** — prints an actionable message pointing to the Obsidian
  CLI registration setting rather than a raw Node.js error. The message includes
  platform-appropriate path hints:
  - macOS: `/Applications/Obsidian.app/Contents/MacOS/obsidian`
  - Windows: `C:\Users\<you>\AppData\Local\Obsidian\Obsidian.exe`
  - Linux: typically on `PATH` after CLI registration

### dryRun consent mechanism

All write/modify tools accept a `dryRun` parameter (boolean, **defaults to
`true`**).

- `dryRun: true` (default) — calls `dryRunPreview(args)` from `_helpers.ts`
  and returns immediately without touching the CLI. The preview shows the exact
  command that *would* run, including any vault prefix.
- `dryRun: false` — calls `runObsidian(args)` and returns the real output.

Tool descriptions instruct the AI assistant to always show the dry-run preview
and obtain explicit user confirmation before calling with `dryRun: false`.

The `eval` tool carries an extra warning because it executes arbitrary
JavaScript inside Obsidian:

> "This executes arbitrary JavaScript inside Obsidian. Always show dryRun
> preview and get explicit user confirmation. Never call with dryRun=false
> autonomously."

---

## Adding a new tool

### 1. Choose or create a tool file

If the tool fits an existing group (`files`, `search`, `daily`, …), add it
there. For a new group, create `src/tools/<group>.ts` and register it in
`src/server.ts`.

### 2. Implement the tool

Follow the pattern in any existing tool file. Required elements:

```typescript
server.tool(
  "tool_name",           // snake_case, unique across all tools
  "Description for the AI assistant.",
  {
    /* Zod schema for input parameters */
  },
  async (params) => {
    const args = ["cli-command", ...];

    // Destructive tools: gate on dryRun
    if (params.dryRun) {
      return { content: [{ type: "text", text: dryRunPreview(args) }] };
    }

    try {
      const output = await runObsidian(args);
      return { content: [{ type: "text", text: output }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: (error as Error).message }],
        isError: true,
      };
    }
  }
);
```

Rules:
- Read-only tools: no `dryRun` parameter, just try/catch around `runObsidian`.
- Destructive tools: include `dryRun: z.boolean().default(true)` and gate on
  it before calling the CLI.
- Always return `isError: true` in the catch block — never throw from a tool
  handler.
- Use `buildFileArgs(file, path)` from `_helpers.ts` whenever the tool targets
  a specific note.

### 3. Update `BASE_TOOL_COUNT` in `src/server.ts`

```typescript
export const BASE_TOOL_COUNT = 32; // was 31
```

The integration test `server.test.ts` asserts the actual registered tool count equals `BASE_TOOL_COUNT` (or `BASE_TOOL_COUNT + SEMANTIC_TOOL_COUNT` when `@xenova/transformers` is available) — it will fail if you forget to update it.

### 4. Add tests

See [Writing unit tests for a tool](#writing-unit-tests-for-a-tool) below.

---

## Testing

### Running tests

```bash
npm test                 # run all tests once
npm run test:watch       # watch mode
npm run test:coverage    # run with coverage report (printed + lcov in coverage/)
```

### Test structure

```
tests/
├── unit/
│   ├── cli.test.ts          runObsidian(): success, error, ENOENT, vault prefix
│   ├── config.test.ts       env var loading, defaults, invalid port
│   ├── health.test.ts       binary found → passes, binary missing → exits
│   └── tools/
│       ├── files.test.ts    6 tools × (happy path + error path + dryRun)
│       └── ...              one file per tool group, same pattern
└── integration/
    ├── http.test.ts         /health, Origin → 403, /mcp, /sse, unknown path → 404
    └── server.test.ts       tool registration count, all tools have names/descriptions
```

### Writing unit tests for a tool

Each tool test file follows the same skeleton:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerXxxTools } from "../../../src/tools/xxx.js";

// Mock the CLI — tests never invoke the real obsidian binary
vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

function makeServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerXxxTools(server);
  return server;
}

async function invoke(server: McpServer, toolName: string, args: Record<string, unknown>) {
  const handler = (server.server as any)._requestHandlers.get("tools/call");
  return await handler({ params: { name: toolName, arguments: args } }, {});
}

describe("xxx tools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRun.mockResolvedValue("mock output");
  });

  it("tool_name — returns CLI output", async () => {
    const result = await invoke(makeServer(), "tool_name", { param: "value" });
    expect(result.content[0].text).toBe("mock output");
    expect(mockRun).toHaveBeenCalledWith(["cli-command", "param=value"]);
  });

  it("tool_name — isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("CLI failed"));
    const result = await invoke(makeServer(), "tool_name", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("CLI failed");
  });

  // For destructive tools:
  it("tool_name — dryRun=true (default) returns preview without calling CLI", async () => {
    const result = await invoke(makeServer(), "tool_name", { dryRun: true });
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("tool_name — dryRun=false calls CLI", async () => {
    const result = await invoke(makeServer(), "tool_name", { dryRun: false });
    expect(mockRun).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });
});
```

### Mocking the CLI

`vi.mock("../../../src/cli.js", () => ({ runObsidian: mockRun }))` replaces
the entire module. `mockRun` is a plain `vi.fn()` — use `.mockResolvedValue()`
for success and `.mockRejectedValue()` for the error path.

**The `promisify.custom` symbol** — relevant only to `cli.test.ts` itself. The
real `execFile` has `[util.promisify.custom]` so `promisify(execFile)` returns
`{ stdout, stderr }`. The mock in `cli.test.ts` replicates this:

```typescript
import { promisify } from "node:util";

const fakeExecFile = Object.assign(
  (_bin: string, _args: string[], _opts: object, _cb: Function) => {},
  {
    [promisify.custom]: (bin: string, args: string[], _opts: object) => {
      // store captured args, return a controllable Promise
    },
  }
);
vi.mock("node:child_process", () => ({ execFile: fakeExecFile }));
```

Do not try to mock `execFile` as a plain `vi.fn()` — it will silently break
the `const { stdout } = await execFileAsync(...)` destructure.

**Config re-loading in unit tests** — `config.ts` exports a singleton
`const config = loadConfig()` evaluated at import time. To test with a
different env, use:

```typescript
vi.resetModules();
vi.doMock("../../src/config.js", () => ({ config: { vault: "TestVault", ... } }));
const { runObsidian } = await import("../../src/cli.js");
```

### Coverage thresholds

Enforced in `vitest.config.ts`:

| Metric | Threshold |
|--------|-----------|
| Lines | 90% |
| Functions | 90% |
| Branches | 85% |

`npm run test:coverage` will exit non-zero if any threshold is not met.
The most common cause of coverage gaps is an uncovered `catch` block — add an
`isError` test for every tool.

---

## Code style

- **TypeScript strict mode** — `"strict": true` in `tsconfig.json`. No `any`
  unless casting through an explicit intermediate type.
- **ESM throughout** — `"type": "module"` in `package.json`. Import paths must
  include the `.js` extension (Node16 module resolution).
- **No shell exec** — always use `execFile`, never `exec` or template-literal
  shell strings.
- **JSDoc on every export** — include `@param` and `@returns` for non-obvious
  parameters. Inline comments for non-obvious logic only.
- **`isError: true`** on tool error returns — never throw from inside a tool
  handler.

---

## Pull request checklist

- [ ] `npm run build` compiles without errors or warnings
- [ ] `npm run check` passes (no lint or format violations)
- [ ] `npm run typecheck` passes (no type errors)
- [ ] `npm test` passes (all tests green)
- [ ] `npm run test:coverage` meets all three thresholds
- [ ] New tools have unit tests covering: happy path, CLI error path, and
      (if destructive) `dryRun: true` and `dryRun: false`
- [ ] `BASE_TOOL_COUNT` in `src/server.ts` updated if base tools were added or removed
- [ ] JSDoc added to all new exported symbols
- [ ] No hardcoded vault names, paths, or personal details
