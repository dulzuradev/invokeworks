import { createMcpGate } from '@liveauth-labs/mcp-server';

export interface ChargeReceipt {
  status?: string;
  callsUsed?: number;
  satsUsed?: number;
  grossSats?: number;
  netSats?: number;
  revenueEventId?: string;
  receipt?: unknown;
  [key: string]: unknown;
}

export interface InvokeOptions {
  requestId: string;
  toolMethodName: string;
  idempotencyKey: string;
  costSats: number;
  metadata?: Record<string, unknown>;
}

export interface LiveAuthGate {
  invoke<I, O>(
    token: string,
    input: I,
    handler: (input: I, context: { liveAuth: { charge: ChargeReceipt } }) => Promise<O>,
    context: { requestId: string },
    options: InvokeOptions,
  ): Promise<O>;
}

export interface LiveAuthAdapter {
  invoke<I, O>(args: {
    token: string;
    toolName: string;
    priceSats: number;
    input: I;
    requestId: string;
    handler: (input: I) => Promise<O>;
  }): Promise<{ output: O; charge: ChargeReceipt }>;
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

export function createLiveAuthAdapter(config: {
  publicKey: string;
  baseUrl: string;
  gateFactory?: (options: { publicKey: string; baseUrl: string; toolName: string }) => LiveAuthGate;
}): LiveAuthAdapter {
  const gateFactory = config.gateFactory ?? ((options) => createMcpGate(options) as LiveAuthGate);
  const gates = new Map<string, LiveAuthGate>();
  return {
    async invoke({ token, toolName, priceSats, input, requestId, handler }) {
      let gate = gates.get(toolName);
      if (!gate) {
        gate = gateFactory({ publicKey: config.publicKey, baseUrl: config.baseUrl, toolName });
        gates.set(toolName, gate);
      }
      return gate.invoke(
        token,
        input,
        async (validatedInput, context) => ({
          output: await handler(validatedInput),
          charge: context.liveAuth.charge,
        }),
        { requestId },
        {
          requestId,
          idempotencyKey: requestId,
          toolMethodName: toolName,
          costSats: priceSats,
          metadata: { service: 'invokeworks' },
        },
      );
    },
  };
}

export function createTestBypassAdapter(): LiveAuthAdapter {
  return {
    async invoke({ token, priceSats, input, requestId, handler }) {
      if (token !== 'test-token') throw new Error('LiveAuth authorization failed');
      return {
        output: await handler(input),
        charge: { status: 'ok', grossSats: priceSats, revenueEventId: `test-${requestId}` },
      };
    },
  };
}
