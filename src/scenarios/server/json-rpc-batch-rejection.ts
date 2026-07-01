/**
 * JSON-RPC batch rejection test scenario for MCP servers.
 *
 * Batch support was removed in 2025-06-18; servers MUST reject POST bodies
 * that are JSON arrays of request objects.
 */

import {
  ClientScenario,
  ConformanceCheck,
  DRAFT_PROTOCOL_VERSION
} from '../../types';
import { buildStandardHeaders, type RunContext } from '../../connection';
import { request } from 'undici';
import { INVALID_REQUEST } from '../../spec-types/2025-06-18';

const SPEC_REFERENCES = [
  {
    id: 'MCP-2025-06-18-Changelog',
    url: 'https://modelcontextprotocol.io/specification/2025-06-18/changelog#major-changes'
  },
  {
    id: 'MCP-Transports',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports'
  }
];

const CLIENT_INFO = {
  name: 'conformance-json-rpc-batch-test',
  version: '1.0.0'
};

function buildBatchBody(specVersion: string): unknown[] {
  if (specVersion === DRAFT_PROTOCOL_VERSION) {
    return [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': specVersion,
            'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
            'io.modelcontextprotocol/clientCapabilities': {}
          }
        }
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': specVersion,
            'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
            'io.modelcontextprotocol/clientCapabilities': {}
          }
        }
      }
    ];
  }

  return [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: specVersion,
        capabilities: {},
        clientInfo: CLIENT_INFO
      }
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
      params: {}
    }
  ];
}

function jsonRpcErrorCode(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const error = (body as { error?: { code?: unknown } }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

function batchWasAccepted(statusCode: number, body: unknown): boolean {
  if (statusCode >= 200 && statusCode < 300 && Array.isArray(body)) {
    return true;
  }
  if (statusCode >= 200 && statusCode < 300 && !Array.isArray(body)) {
    const result = (body as { result?: unknown })?.result;
    if (result !== undefined) {
      return true;
    }
  }
  return false;
}

async function sendJsonRpcBatch(
  serverUrl: string,
  specVersion: string
): Promise<{ statusCode: number; body: unknown }> {
  const batch = buildBatchBody(specVersion);
  const first = batch[0] as {
    method: string;
    params?: Record<string, unknown>;
  };
  const response = await request(serverUrl, {
    method: 'POST',
    headers: buildStandardHeaders(first.method, first.params, {
      specVersion: specVersion as RunContext['specVersion']
    }),
    body: JSON.stringify(batch)
  });

  let body: unknown;
  try {
    body = await response.body.json();
  } catch {
    body = null;
  }

  return {
    statusCode: response.statusCode,
    body
  };
}

export class JsonRpcBatchRejectionScenario implements ClientScenario {
  name = 'json-rpc-batch-rejection';
  readonly source = { introducedIn: '2025-06-18' } as const;
  description = `Test that the server rejects JSON-RPC batch requests.

**Scope:** From 2025-06-18 onward MCP no longer supports JSON-RPC batch arrays on the wire.

**Requirements:**
- Server **MUST** reject an HTTP POST body that is a JSON array of JSON-RPC request objects
- Rejection is expected to use HTTP \`400 Bad Request\` with JSON-RPC error code \`-32600\` (Invalid Request)`;

  async run(ctx: RunContext): Promise<ConformanceCheck[]> {
    const { serverUrl, specVersion } = ctx;
    const timestamp = new Date().toISOString();
    const checkBase = {
      id: 'json-rpc-batch-rejected',
      name: 'JsonRpcBatchRejected',
      description:
        'Server rejects JSON-RPC batch POST bodies (JSON array of requests)',
      timestamp,
      specReferences: SPEC_REFERENCES
    };

    try {
      const response = await sendJsonRpcBatch(serverUrl, specVersion);
      const errorCode = jsonRpcErrorCode(response.body);
      const accepted = batchWasAccepted(response.statusCode, response.body);
      const details = {
        statusCode: response.statusCode,
        errorCode,
        body: response.body,
        batchSize: buildBatchBody(specVersion).length
      };

      if (accepted) {
        return [
          {
            ...checkBase,
            status: 'FAILURE',
            errorMessage:
              'Server accepted a JSON-RPC batch array; batch requests are not supported from 2025-06-18 onward',
            details
          }
        ];
      }

      const hasInvalidRequest =
        response.statusCode === 400 && errorCode === INVALID_REQUEST;
      if (hasInvalidRequest) {
        return [
          {
            ...checkBase,
            status: 'SUCCESS',
            details
          }
        ];
      }

      const reasons: string[] = [];
      if (response.statusCode !== 400) {
        reasons.push(`expected HTTP 400, got ${response.statusCode}`);
      }
      if (errorCode !== INVALID_REQUEST) {
        reasons.push(
          errorCode === undefined
            ? 'expected JSON-RPC error code -32600 (Invalid Request)'
            : `expected JSON-RPC error code -32600, got ${errorCode}`
        );
      }

      return [
        {
          ...checkBase,
          status: 'FAILURE',
          errorMessage: `Server rejected the batch but not with the expected signature: ${reasons.join('; ')}`,
          details
        }
      ];
    } catch (error) {
      return [
        {
          ...checkBase,
          status: 'FAILURE',
          errorMessage: `Request failed: ${error instanceof Error ? error.message : String(error)}`
        }
      ];
    }
  }
}
