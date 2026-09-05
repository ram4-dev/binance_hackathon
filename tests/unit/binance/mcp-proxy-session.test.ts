import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createMcpStdioSession,
  McpAuthRequiredError,
  isAuthRequiredStderr,
} from '../../../src/binance/mcp-proxy-client.js';

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'proxy-mcp-server.mjs');
const worktreeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function serverParameters(mode?: string) {
  return {
    command: process.execPath,
    args: [fixturePath],
    cwd: worktreeRoot,
    env: { ...process.env, ...(mode ? { MCP_PROXY_FIXTURE_MODE: mode } : {}) },
    stderr: 'pipe' as const,
  };
}

function textOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const content = (value as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  for (const entry of content) {
    if (Boolean(entry) && typeof entry === 'object') {
      const row = entry as Record<string, unknown>;
      if (row.type === 'text' && typeof row.text === 'string') return row.text;
    }
  }
  return null;
}

function decodeJson(value: unknown): unknown {
  const text = textOf(value);
  return text ? (JSON.parse(text) as unknown) : value;
}

async function connectSession() {
  const session = createMcpStdioSession({
    serverParameters: serverParameters(),
    handshakeTimeoutMs: 5000,
    callTimeoutMs: 5000,
  });
  await session.connect();
  return session;
}

describe('createMcpStdioSession over a stdio MCP child', () => {
  it('lists the Binance tools after connecting', async () => {
    const session = await connectSession();
    try {
      const discovery = await session.listTools();
      const names = discovery.tools.map((tool) => tool.name);
      expect(names).toContain('get_market_quote');
      expect(names).toContain('get_binance_balance');
      expect(names).toContain('place_binance_order');
      expect(names).toContain('binance_internal_transfer');
      expect(names).toContain('get_binance_history');
    } finally {
      await session.close();
    }
  });

  it('calls a tool and surfaces a decodable market quote', async () => {
    const session = await connectSession();
    try {
      const raw = await session.callTool('get_market_quote', { symbol: 'BTC' });
      const data = decodeJson(raw) as Record<string, unknown>;
      expect(data.symbol).toBe('BTC');
      expect(data.bid).toBe('60000.00');
      expect(data.ask).toBe('60005.00');
      expect(data.last).toBe('60002.50');
    } finally {
      await session.close();
    }
  });

  it('enforces the call timeout when a tool hangs', async () => {
    const session = createMcpStdioSession({
      serverParameters: serverParameters(),
      handshakeTimeoutMs: 5000,
      callTimeoutMs: 300,
    });
    await session.connect();
    try {
      await expect(session.callTool('hang_forever', {})).rejects.toThrow(/timed out after 300ms/);
    } finally {
      await session.close();
    }
  });

  it('surfaces McpAuthRequiredError when the child requires OAuth instead of failing closed', async () => {
    const session = createMcpStdioSession({
      serverParameters: serverParameters('auth-required'),
      handshakeTimeoutMs: 5000,
      callTimeoutMs: 1000,
    });
    await expect(session.connect()).rejects.toBeInstanceOf(McpAuthRequiredError);
  });
});

describe('isAuthRequiredStderr', () => {
  it('recognizes mcp-remote OAuth markers in stderr', () => {
    expect(isAuthRequiredStderr('[1] Authentication required. Initializing auth...')).toBe(true);
    expect(isAuthRequiredStderr('[1] To authorize this client, visit: https://x')).toBe(true);
    expect(isAuthRequiredStderr('[1] Authentication required. Waiting for authorization...')).toBe(true);
    expect(isAuthRequiredStderr('[1] Using the OAuth device grant; no browser will be opened on this machine')).toBe(true);
    expect(isAuthRequiredStderr('[1] Browser opened automatically.')).toBe(false);
  });

  it('ignores unrelated stderr', () => {
    expect(isAuthRequiredStderr('[1] Fatal error: socket hang up')).toBe(false);
    expect(isAuthRequiredStderr('')).toBe(false);
  });
});
