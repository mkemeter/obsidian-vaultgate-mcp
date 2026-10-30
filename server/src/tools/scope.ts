import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  discoverScopes,
  getActiveScope,
  getHomeScope,
  isScopeSwitchingEnabled,
  setActiveScope,
} from "../scope.js";

/**
 * Registers vault scope tools on the MCP server.
 *
 * Tools registered:
 * - `vault_scope`     — inspect the active scope (always registered when scoping is enabled)
 * - `vault_scope_set` — switch to a different scope (opt-in, only when VAULTGATE_SCOPE_SWITCHING=true)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerScopeTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // vault_scope
  // ---------------------------------------------------------------------------
  server.tool(
    "vault_scope",
    "Inspect the active vault scope and list all available scopes. " +
      "Returns the current scope (active for this session), the home scope (default at startup), " +
      "and the full list of available scope names. " +
      "Use this to understand what section of the vault is currently accessible.",
    {},
    () => {
      const current = getActiveScope();
      const home = getHomeScope();
      const available = discoverScopes();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ current, home, available }, null, 2),
          },
        ],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // vault_scope_set (opt-in only)
  // ---------------------------------------------------------------------------
  if (isScopeSwitchingEnabled()) {
    server.tool(
      "vault_scope_set",
      "Switch the active vault scope. " +
        "Call ONLY when the user explicitly requests to work in a different scope — " +
        "do NOT switch scopes automatically or in response to access errors. " +
        "Note: the switch affects all active sessions sharing this server process. " +
        "The scope resets to the home scope when the server restarts.",
      {
        scope: z.string().describe("Target scope name. Must be one of the available scopes."),
      },
      ({ scope }) => {
        const available = discoverScopes();
        if (!available.includes(scope)) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown scope "${scope}". Available scopes: ${available.join(", ")}.`,
              },
            ],
            isError: true,
          };
        }
        setActiveScope(scope);
        return {
          content: [
            {
              type: "text",
              text: `Active scope switched to "${scope}".`,
            },
          ],
        };
      }
    );
  }
}
