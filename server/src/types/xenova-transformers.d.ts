/**
 * Minimal type shim for @xenova/transformers (optional dependency).
 *
 * Provides just enough type information for TypeScript to compile semantic.ts
 * without requiring the package to be installed in dev/CI environments.
 * The real package types are used at runtime when the package is available.
 */
declare module "@xenova/transformers" {
  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>
  ): Promise<PipelineFunction>;

  export type PipelineFunction = (
    input: string | string[],
    options?: Record<string, unknown>
  ) => Promise<PipelineOutput>;

  export interface PipelineOutput {
    tolist(): number[][];
  }
}
