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
  outOfRange?: boolean;
  outOfRangeStartAt?: string | null;
  rebalanceRemainingSec?: number | null;
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
  liquidity?: string;
};

export type BotState = {
  snapshot: MonitorSnapshot | null;
  config: RuntimeConfig;
  logs: LogEntry[];
  logSeq: number;
};

export type LogEntry = {
  id: number;
  timestamp: string;
  message: string;
  tokenId?: string;
};

const LOG_LIMIT = 200;

const state: BotState = {
  snapshot: null,
  config: loadRuntimeConfig(),
  logs: [],
  logSeq: 0,
};

export function getSnapshot(): MonitorSnapshot | null {
  return state.snapshot;
}

export function setSnapshot(snapshot: MonitorSnapshot): void {
  state.snapshot = snapshot;
}

export function clearSnapshot(): void {
  state.snapshot = null;
}

export function getConfig(): RuntimeConfig {
  return state.config;
}

export function updateConfig(next: Partial<RuntimeConfig>): RuntimeConfig {
  state.config = { ...state.config, ...next };
  return state.config;
}

export function addLog(message: string, timestamp = new Date().toISOString(), tokenId?: string): void {
  state.logSeq += 1;
  state.logs.push({ id: state.logSeq, timestamp, message, tokenId });
  if (state.logs.length > LOG_LIMIT) {
    state.logs.splice(0, state.logs.length - LOG_LIMIT);
  }
}

export function getLogs(limit = 50): LogEntry[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50;
  return state.logs.slice(-safeLimit);
}
