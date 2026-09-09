import { createRequire } from 'node:module';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type { BinanceClient } from './client.js';
import { TestnetBinanceClient } from './client.testnet.js';
import { decodeToolSearch, McpBinanceSessionAdapter, type McpBinanceSession } from './mcp-remote-client.js';
import { DEFAULT_BINANCE_MCP_URL, type BinanceConfig } from '../config/binance.js';
import {
  type BinanceBalance,
  type BinanceDegradation,
  type BinanceHealth,
  type BinanceHistoryEntry,
  type BinanceInternalTransferRequest,
  type BinanceInternalTransferResult,
  type BinanceOrderRequest,
  type BinanceOrderResult,
  type MarketQuote,
} from './types.js';

const require = createRequire(import.meta.url);

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 20_000;
const DEFAULT_CALL_TIMEOUT_MS = 15_000;

/**
 * Minimal, secrets-free environment allowlist for spawning the mcp-remote child.
 *
 * mcp-remote needs HOME (to cache OAuth tokens in ~/.mcp-auth) and PATH (to open a
 * browser for the authorization-code + PKCE flow). No credentials are ever passed:
 * mcp-remote performs its own OAuth and stores the tokens itself.
 */
const SAFE_ENVIRONMENT_NAMES = [
  'HOME',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
] as const;

/**
 * stderr markers mcp-remote writes when it needs OAuth.
 *
 * mcp-remote exits with code 1 for every fatal error, so an "auth needed"
 * first-connection can only be distinguished from a generic outage by the markers
 * it logs to stderr (mcp-remote pipes all log output there, never to stdout, which
 * carries the MCP frames).
 */
const AUTH_REQUIRED_MARKERS = [
  'Authentication required',
  'authorize this client',
  'Waiting for authorization',
  'device grant',
  'OAuth device grant',
] as const;

/** Resolve the mcp-remote stdio proxy entrypoint bundled in node_modules. */
export function resolveMcpRemoteEntry(): string {
  return require.resolve('mcp-remote/dist/proxy.js');
}

/** Build the allowlisted environment for the mcp-remote child process. */
export function allowlistedProxyEnvironment(environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const inherited = getDefaultEnvironment();
  const result: Record<string, string> = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    const value = environment[name] ?? inherited[name];
    if (value) result[name] = value;
  }
  return result;
}

/** True when mcp-remote stderr indicates an OAuth login is required. */
export function isAuthRequiredStderr(stderr: string): boolean {
  return AUTH_REQUIRED_MARKERS.some((marker) => stderr.includes(marker));
}

/**
 * Raised on a first connection that needs OAuth. It is intentionally NOT a
 * degradation: the operator must authenticate in the browser before the proxy can
 * serve the Binance tools, so we surface an actionable login command instead of
 * silently falling back to testnet.
 */
export class McpAuthRequiredError extends Error {
  public readonly url: string;

  public constructor(url: string) {
    super(
      `Binance Agent OS requires OAuth authentication. Run \`npx mcp-remote ${url}\` ` +
        `in a terminal to authenticate in the browser (the token is cached in ~/.mcp-auth), then retry.`,
    );
    this.name = 'McpAuthRequiredError';
    this.url = url;
  }
}

export type McpStdioSessionOptions = {
  serverParameters: StdioServerParameters;
  url?: string;
  handshakeTimeoutMs?: number;
  callTimeoutMs?: number;
};

/**
 * Bridges an SDK `Client` over a stdio child process (mcp-remote in production, a
 * fake SDK server in tests) to the `McpBinanceSession` interface.
 *
 * Enforces a handshake timeout on `connect` and a call timeout on `listTools` /
 * `callTool`. When a connect failure is accompanied by mcp-remote OAuth markers in
 * stderr, it raises `McpAuthRequiredError` instead of a generic failure.
 */
export function createMcpStdioSession(options: McpStdioSessionOptions): McpBinanceSession {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const url = options.url ?? DEFAULT_BINANCE_MCP_URL;
  const transport = new StdioClientTransport(options.serverParameters);
  const client = new Client({ name: 'binance-agent-os', version: '0.1.0' });
  let stderrBuffer = '';

  transport.stderr?.on('data', (chunk: Buffer | string) => {
    stderrBuffer = `${stderrBuffer}${String(chunk)}`.slice(-1000);
  });

  return {
    connect: async () => {
      try {
        await within(client.connect(transport), handshakeTimeoutMs, 'handshake');
      } catch (error) {
        if (isAuthRequiredStderr(stderrBuffer)) {
          await client.close().catch(() => {});
          throw new McpAuthRequiredError(url);
        }
        throw error;
      }
    },
        searchTools: (category, cursor) =>
          withDiagnostics(
            within(
              client.callTool({ name: 'tool_search', arguments: { category, ...(cursor ? { cursor } : {}) } }),
              callTimeoutMs,
              'tool_search',
            ).then(decodeToolSearch),
          ),
        executeTool: (toolName, args) =>
          withDiagnostics(
            within(client.callTool({ name: 'tool_execute', arguments: { toolName, arguments: args } }), callTimeoutMs, 'tool_execute'),
          ),
        close: () => client.close(),
  };

  async function withDiagnostics<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (isAuthRequiredStderr(stderrBuffer)) {
        await client.close().catch(() => {});
        throw new McpAuthRequiredError(url);
      }
      throw error;
    }
  }
}

export type McpProxyBinanceClientOptions = {
  config: BinanceConfig;
  createSession?: (config: BinanceConfig) => Promise<McpBinanceSession>;
  createTestnetClient?: (config: BinanceConfig) => BinanceClient;
  handshakeTimeoutMs?: number;
  callTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  clock?: () => string;
};

/**
 * mcp-remote backed transport for the Binance Agent OS server.
 *
 * When no `BINANCE_MCP_TOKEN` is configured, this client spawns
 * `mcp-remote <mcpUrl>` as a stdio child process and bridges it to the
 * `BinanceClient` interface. The first-run OAuth login opens the browser through
 * mcp-remote and the token is cached in ~/.mcp-auth; on a connection failure that
 * needs auth, it raises `McpAuthRequiredError` instead of degrading. Any other
 * connection failure degrades to the configured testnet transport and records the
 * reason (never silently).
 */
export class McpProxyBinanceClient implements BinanceClient {
  public readonly id = 'binance-mcp';
  public readonly source = 'mcp' as const;
  private readonly options: McpProxyBinanceClientOptions;
  private readonly clock: () => string;
  private backing: BinanceClient | undefined;
  private degradationState: BinanceDegradation | undefined;

  public constructor(options: McpProxyBinanceClientOptions) {
    this.options = options;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public get degradation(): BinanceDegradation | undefined {
    return this.degradationState;
  }

  public async health(): Promise<BinanceHealth> {
    try {
      await this.getBacking();
    } catch (error) {
      if (error instanceof McpAuthRequiredError) {
        return { status: 'unavailable', source: 'mcp', reason: error.message };
      }
      throw error;
    }
    if (this.degradationState) {
      return {
        status: 'degraded',
        source: 'mcp',
        reason: this.degradationState.reason,
        degradation: this.degradationState,
      };
    }
    return { status: 'healthy', source: 'mcp' };
  }

  public async getMarketQuote(symbol: string): Promise<MarketQuote> {
    return (await this.getBacking()).getMarketQuote(symbol);
  }

  public async getBalance(asset?: string): Promise<BinanceBalance[]> {
    return (await this.getBacking()).getBalance(asset);
  }

  public async placeOrder(request: BinanceOrderRequest): Promise<BinanceOrderResult> {
    return (await this.getBacking()).placeOrder(request);
  }

  public async internalTransfer(request: BinanceInternalTransferRequest): Promise<BinanceInternalTransferResult> {
    return (await this.getBacking()).internalTransfer(request);
  }

  public async getHistory(asset?: string): Promise<BinanceHistoryEntry[]> {
    return (await this.getBacking()).getHistory(asset);
  }

  public async close(): Promise<void> {
    await this.backing?.close();
  }

  private async getBacking(): Promise<BinanceClient> {
    if (this.backing) return this.backing;
    try {
      const session = await this.createSession();
      await session.connect();
      this.backing = new McpBinanceSessionAdapter(session, this.clock);
    } catch (error) {
      if (error instanceof McpAuthRequiredError) {
        throw error;
      }
      if (!this.options.config.mcpDegrade) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : 'mcp-remote proxy connection failed.';
      this.degradationState = { from: 'mcp', to: 'testnet', reason, timestamp: this.clock() };
      this.backing = this.createTestnetClient();
    }
    return this.backing;
  }

  private async createSession(): Promise<McpBinanceSession> {
    if (this.options.createSession) return this.options.createSession(this.options.config);
    const url = this.options.config.mcpUrl ?? DEFAULT_BINANCE_MCP_URL;
    const serverParameters: StdioServerParameters = {
      command: process.execPath,
      args: [resolveMcpRemoteEntry(), url],
      cwd: process.cwd(),
      env: allowlistedProxyEnvironment(this.options.environment),
      stderr: 'pipe',
    };
    return createMcpStdioSession({
      serverParameters,
      url,
      handshakeTimeoutMs: this.options.handshakeTimeoutMs,
      callTimeoutMs: this.options.callTimeoutMs,
    });
  }

  private createTestnetClient(): BinanceClient {
    if (this.options.createTestnetClient) return this.options.createTestnetClient(this.options.config);
    return new TestnetBinanceClient({ config: this.options.config });
  }
}

async function within<T>(operation: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
