import { evalite } from 'evalite';
import { agentScorers, runAgentScenario } from '../helpers.js';
import type { AgentExpected, AgentScenario } from './types.js';
import { guardBinanceScenarios } from './guards-binance.js';
import { previewConfirmBinanceScenarios } from './preview-confirm-binance.js';

function dataFor(
  scenarios: AgentScenario[],
): Array<{ input: AgentScenario; expected: AgentExpected }> {
  return scenarios.map((scenario) => ({ input: scenario, expected: scenario.expected }));
}

evalite('Agent: Binance guards', {
  data: dataFor(guardBinanceScenarios),
  task: (scenario: AgentScenario) => runAgentScenario(scenario),
  scorers: agentScorers,
});

evalite('Agent: Binance preview → confirm flow', {
  data: dataFor(previewConfirmBinanceScenarios),
  task: (scenario: AgentScenario) => runAgentScenario(scenario),
  scorers: agentScorers,
});
