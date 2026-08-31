import { z } from "zod";

/**
 * Validated contract for messages the tray companion sends to the server over
 * the `utilityProcess` MessagePort.
 *
 * The channel uses structured clone (`child.postMessage(obj)`), so numbers and
 * booleans arrive with their types intact — the schemas therefore expect real
 * `number`/`boolean`, and anything else is treated as genuinely malformed and
 * rejected. Every field is optional so a partial patch (e.g. vault-only) applies
 * exactly as before; unknown extra fields are tolerated for forward compatibility.
 *
 * Parsing at this boundary replaces the previous hand-written `msg as {…}` cast,
 * which trusted the sender blindly — the failure mode behind IPC messages that
 * were silently dropped or misinterpreted.
 */

/** A partial update to the runtime config, as sent under `__vaultgate_config__`. */
const configPatchSchema = z.object({
  vault: z.string().optional(),
  injectConventions: z.boolean().optional(),
  injectIntervalSecs: z.number().optional(),
});

/** Validated shape of a `__vaultgate_config__` message. */
const configMessageSchema = z.object({
  __vaultgate_config__: configPatchSchema,
});

/** Manual index control commands the tray can trigger. */
const controlCommandSchema = z.enum(["rebuild_index", "clear_index"]);

/** Validated shape of a `__vaultgate_control__` message. */
const controlMessageSchema = z.object({
  __vaultgate_control__: z.object({
    command: controlCommandSchema,
  }),
});

/** A validated runtime-config patch from the tray. */
type ConfigPatch = z.infer<typeof configPatchSchema>;

/** A validated index control command from the tray. */
type ControlCommand = z.infer<typeof controlCommandSchema>;

/** The parsed, validated result of an incoming IPC message. */
export type IpcMessage =
  | { kind: "config"; patch: ConfigPatch }
  | { kind: "control"; command: ControlCommand };

/**
 * Parses and validates an incoming IPC message from the tray.
 *
 * @param msg  The raw, already-unwrapped message value (`event.data`).
 * @returns    A discriminated `IpcMessage` when the message matches a known,
 *             well-formed contract; `null` for any unrecognized or malformed
 *             input (the caller should log and drop it).
 */
export function parseIpcMessage(msg: unknown): IpcMessage | null {
  const asConfig = configMessageSchema.safeParse(msg);
  if (asConfig.success) {
    return { kind: "config", patch: asConfig.data.__vaultgate_config__ };
  }

  const asControl = controlMessageSchema.safeParse(msg);
  if (asControl.success) {
    return { kind: "control", command: asControl.data.__vaultgate_control__.command };
  }

  return null;
}
