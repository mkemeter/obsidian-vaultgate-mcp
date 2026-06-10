import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { dryRunPreview, dryRunSchema, optionalBoolSchema, requiredBoolSchema } from "./_helpers.js";

/**
 * Registers developer and debug tools on the MCP server.
 *
 * These tools are primarily useful for Obsidian plugin/theme development.
 * Several of them are destructive and require explicit `dryRun: false`.
 *
 * Tools registered (read-only):
 * - `dev_errors`   — inspect JavaScript errors in the app
 * - `dev_console`  — read console output
 * - `dev_css`      — inspect computed CSS values
 * - `dev_dom`      — query DOM elements
 *
 * Tools registered (destructive, dryRun gated):
 * - `eval`           — execute JavaScript in the Obsidian app context ⚠️
 * - `dev_screenshot` — capture a screenshot of the Obsidian window
 * - `dev_mobile`     — toggle mobile emulation
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerDevTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // eval — destructive ⚠️ (dryRun gated + extra warning)
  // ---------------------------------------------------------------------------
  server.tool(
    "eval",
    "Execute JavaScript in the Obsidian app context and return the result.\n\n" +
      "The code runs inside an async function, so `await` and `return` work at the top level:\n" +
      "  `const files = await app.vault.getFiles(); return files.length;`\n\n" +
      "⚠️  WARNING: This executes arbitrary JavaScript inside your running Obsidian instance.\n" +
      "It can read vault data, modify files, call plugins, or cause data loss.\n\n" +
      "IMPORTANT: ALWAYS call with dryRun=true first, show the user EXACTLY what code will run, " +
      "and wait for EXPLICIT confirmation before calling with dryRun=false. " +
      "Never call with dryRun=false autonomously.",
    {
      code: z
        .string()
        .describe(
          "JavaScript to execute. `await` and `return` work at the top level. " +
            "Example: `const files = await app.vault.getFiles(); return files.length;`"
        ),
      dryRun: dryRunSchema.describe(
          "When true (default), returns a preview without executing. " +
            "Set to false ONLY after showing the user the exact code and receiving explicit confirmation."
        ),
    },
    async ({ code, dryRun }) => {
      // Wrap in an async IIFE so `await` and `return` work at the top level of
      // the user's code, regardless of how the Obsidian CLI evaluates the expression.
      const wrappedCode = `(async () => {\n${code}\n})()`;
      const args = ["eval", `code=${wrappedCode}`];

      if (dryRun) {
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

  // ---------------------------------------------------------------------------
  // dev_errors — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "dev_errors",
    "Retrieve JavaScript errors captured by Obsidian. Useful for debugging plugin issues.",
    {},
    async () => {
      try {
        const output = await runObsidian(["dev:errors"]);
        return { content: [{ type: "text", text: output || "No errors found." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // dev_console — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "dev_console",
    "Read recent console output from the Obsidian app.",
    {
      level: z
        .enum(["log", "warn", "error"])
        .optional()
        .describe("Filter by log level. Returns all levels when omitted."),
    },
    async ({ level }) => {
      const args = ["dev:console"];
      if (level) args.push(`level=${level}`);

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || "No console output." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // dev_css — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "dev_css",
    "Inspect computed CSS property values for a DOM selector.",
    {
      selector: z
        .string()
        .describe("CSS selector to target, e.g. `.workspace-leaf`."),
      prop: z
        .string()
        .describe("CSS property name to inspect, e.g. `background-color`."),
    },
    async ({ selector, prop }) => {
      const args = ["dev:css", `selector=${selector}`, `prop=${prop}`];
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

  // ---------------------------------------------------------------------------
  // dev_dom — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "dev_dom",
    "Query DOM elements in the Obsidian window matching a CSS selector.",
    {
      selector: z
        .string()
        .describe("CSS selector, e.g. `.workspace-leaf` or `#app`."),
      text: optionalBoolSchema.describe("Return only the text content of matched elements."),
    },
    async ({ selector, text }) => {
      const args = ["dev:dom", `selector=${selector}`];
      if (text) args.push("text");

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

  // ---------------------------------------------------------------------------
  // dev_screenshot — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "dev_screenshot",
    "Capture a screenshot of the Obsidian window and save it to a file.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      path: z
        .string()
        .describe("Output file path for the screenshot, e.g. `screenshot.png`."),
      dryRun: dryRunSchema,
    },
    async ({ path, dryRun }) => {
      const args = ["dev:screenshot", `path=${path}`];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Screenshot saved to: ${path}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // dev_mobile — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "dev_mobile",
    "Toggle mobile device emulation in the Obsidian window.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      on: requiredBoolSchema.describe("Pass `true` to enable mobile view, `false` to disable."),
      dryRun: dryRunSchema,
    },
    async ({ on, dryRun }) => {
      const args = ["dev:mobile", on ? "on" : "off"];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return {
          content: [
            { type: "text", text: output || `Mobile emulation ${on ? "enabled" : "disabled"}.` },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
