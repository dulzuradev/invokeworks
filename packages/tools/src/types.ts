import type { z } from 'zod';

export interface ToolContext {
  signal?: AbortSignal;
  correlationId: string;
}

export interface ToolResult<T> {
  data: T;
}

export interface ToolDefinition<S extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  displayName: string;
  description: string;
  longDescription: string;
  priceSats: number;
  inputSchema: S;
  handler: (input: z.output<S>, context: ToolContext) => Promise<ToolResult<O>>;
  docs: { category: string; examples: Array<Record<string, unknown>> };
}

export function defineTool<S extends z.ZodType, O>(
  tool: ToolDefinition<S, O>,
): ToolDefinition<S, O> {
  return tool;
}
