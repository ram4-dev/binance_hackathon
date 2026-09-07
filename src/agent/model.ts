import { randomUUID } from 'node:crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type OpenCodeGoModelConfig = {
  apiKey?: string;
  baseURL: string;
  model: string;
};

export function getOpenCodeGoModelConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OpenCodeGoModelConfig {
  return {
    apiKey: environment.OPENCODE_GO_API_KEY,
    baseURL: environment.OPENCODE_GO_BASE_URL ?? 'https://opencode.ai/zen/go/v1',
    model: environment.OPENCODE_GO_MODEL ?? 'deepseek-v4-flash',
  };
}

const config = getOpenCodeGoModelConfig();

// OpenCode Go requires a stable `x-opencode-session` header for routing
// (server-side requirement added after the original integration; verified
// 200 with the header vs 400 MissingSessionID without it). One session id
// per process is enough for the text agent loop; operators can pin one via
// OPENCODE_GO_SESSION_ID.
const opencodeSessionId = process.env.OPENCODE_GO_SESSION_ID ?? randomUUID();

const opencodeGo = createOpenAICompatible({
  name: 'opencode-go',
  apiKey: config.apiKey,
  baseURL: config.baseURL,
  headers: { 'x-opencode-session': opencodeSessionId },
});

export const model = opencodeGo.chatModel(config.model);
