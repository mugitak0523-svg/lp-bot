import { loadRuntimeConfig, RuntimeConfig } from '../config/runtime';

export type MonitorSnapshot = {
  timestamp: string;
  trigger: string;
  status: string;
  symbol0: string;
  symbol1: string;
  price0In1: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  ratio0: number;
  ratio1: number;
  amount0: number;
  amount1: number;
  netValueIn1: number;
  pnl: number;
  pnlPct: number;
  fee0: number;
  fee1: number;
  feeTotalIn1: number;
  feeYieldPct: number;
};

export type BotState = {
  snapshot: MonitorSnapshot | null;
  config: RuntimeConfig;
};

const state: BotState = {
  snapshot: null,
  config: loadRuntimeConfig(),
};

export function getSnapshot(): MonitorSnapshot | null {
  return state.snapshot;
}

export function setSnapshot(snapshot: MonitorSnapshot): void {
  state.snapshot = snapshot;
}

export function getConfig(): RuntimeConfig {
  return state.config;
}

export function updateConfig(next: Partial<RuntimeConfig>): RuntimeConfig {
  state.config = { ...state.config, ...next };
  return state.config;
}
