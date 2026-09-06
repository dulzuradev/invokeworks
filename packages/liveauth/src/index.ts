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
      let acceptedCharge: ChargeReceipt | undefined;
      try {
        return await gate.invoke(
          token,
          input,
          async (validatedInput, context) => {
            acceptedCharge = context.liveAuth.charge;
            return { output: await handler(validatedInput), charge: acceptedCharge };
          },
          { requestId },
          {
            idempotencyKey: requestId,
            toolMethodName: toolName,
            costSats: priceSats,
            metadata: { service: 'invokeworks' },
          },
        );
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'tool_execution_failed'
        ) {
          throw error;
        }
        // Support SDK 1.1.x while 1.2.0 is awaiting publication.
        if (acceptedCharge) {
          const failure = Object.assign(
            new Error('Tool execution failed after LiveAuth authorization'),
            {
              name: 'LiveAuthExecutionError',
              code: 'tool_execution_failed',
              charge: acceptedCharge,
              idempotencyKey: requestId,
            },
          );
          Object.defineProperty(failure, 'cause', { value: error, enumerable: false });
          throw failure;
        }
        throw error;
      }
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

/** Only expose public billing fields; never spread an error, context, or cause. */
export function liveAuthErrorMeta(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};
  const value = error as Record<string, unknown>;
  if (value.code === 'tool_execution_failed' && value.charge && typeof value.charge === 'object') {
    const charge = value.charge as Record<string, unknown>;
    const publicCharge: Record<string, unknown> = {};
    for (const key of [
      'status',
      'callsUsed',
      'satsUsed',
      'grossSats',
      'platformFeeSats',
      'netSats',
      'feeBasisPoints',
      'revenueEventId',
      'toolId',
      'toolName',
      'toolSlug',
    ]) {
      if (typeof charge[key] === 'string' || typeof charge[key] === 'number')
        publicCharge[key] = charge[key];
    }
    if (charge.receipt && typeof charge.receipt === 'object') {
      const receipt = charge.receipt as Record<string, unknown>;
      const safeReceipt: Record<string, unknown> = {};
      for (const key of ['version', 'payload', 'signature', 'signatureAlgorithm', 'keyId']) {
        if (typeof receipt[key] === 'string') safeReceipt[key] = receipt[key];
      }
      if (receipt.body && typeof receipt.body === 'object') {
        const body = receipt.body as Record<string, unknown>;
        const safeBody: Record<string, unknown> = {};
        for (const key of [
          'receiptId',
          'revenueEventId',
          'mcpToolId',
          'toolName',
          'toolSlug',
          'toolMethodName',
          'mcpGateTokenId',
          'mcpGateSessionId',
          'payingProjectId',
          'agentId',
          'grossSats',
          'platformFeeSats',
          'netSats',
          'feeBasisPoints',
          'status',
          'idempotencyKey',
          'requestId',
          'createdAt',
        ]) {
          if (typeof body[key] === 'string' || typeof body[key] === 'number' || body[key] === null)
            safeBody[key] = body[key];
        }
        safeReceipt.body = safeBody;
      }
      publicCharge.receipt = safeReceipt;
    }
    return {
      liveauth: {
        ...publicCharge,
        billed: charge.status === 'ok',
        ...(typeof value.idempotencyKey === 'string'
          ? { idempotencyKey: value.idempotencyKey }
          : {}),
      },
    };
  }
  if (value.name === 'ChargeDeniedError' || value.name === 'BudgetExceededError') {
    const details =
      value.details && typeof value.details === 'object'
        ? (value.details as Record<string, unknown>)
        : {};
    const reason = value.reason ?? details.reason ?? 'denied';
    const known = [
      'tool_inactive',
      'tool_unpublished',
      'tool_not_found',
      'budget_exceeded',
      'rate_limited',
    ];
    return {
      liveauth: {
        status: 'deny',
        billed: false,
        reason: known.includes(String(reason)) ? reason : 'denied',
      },
    };
  }
  return {};
}
