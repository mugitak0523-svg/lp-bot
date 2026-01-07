import 'dotenv/config';

export type Settings = {
  rpcUrl: string;
  rpcWss: string;
  tokenId: string;
  poolAddress: string;
  chainId: number;
  updateIntervalMs: number;
};

export type WriteSettings = Settings & {
  privateKey: string;
  tickRange: number;
  slippageToleranceBps: number;
  rebalanceDeadlineSec: number;
  removePercent: number;
  targetTotalToken1: number;
};

export function loadSettings(): Settings {
  const rpcUrl = process.env.RPC_URL ?? '';
  const rpcWss = process.env.RPC_WSS ?? '';
  const tokenId = process.env.TOKEN_ID ?? '';
  const poolAddress = process.env.POOL_ADDRESS ?? '';
  const chainId = Number(process.env.CHAIN_ID ?? '42161');
  const updateIntervalMs = Number(process.env.UPDATE_INTERVAL_MS ?? '5000');

  if (!rpcUrl) throw new Error('RPC_URL missing');
  if (!rpcWss) throw new Error('RPC_WSS missing');
  if (!tokenId) throw new Error('TOKEN_ID missing');
  if (!poolAddress) throw new Error('POOL_ADDRESS missing');
  if (!Number.isFinite(chainId)) throw new Error('CHAIN_ID invalid');
  if (!Number.isFinite(updateIntervalMs)) throw new Error('UPDATE_INTERVAL_MS invalid');

  return {
    rpcUrl,
    rpcWss,
    tokenId,
    poolAddress,
    chainId,
    updateIntervalMs,
  };
}

export function loadWriteSettings(): WriteSettings {
  const base = loadSettings();
  const privateKey = process.env.PRIVATE_KEY ?? '';
  const tickRange = Number(process.env.TICK_RANGE ?? '50');
  const slippageToleranceBps = Number(process.env.SLIPPAGE_BPS ?? '50');
  const rebalanceDeadlineSec = Number(process.env.REBALANCE_DEADLINE_SEC ?? '1200');
  const removePercent = Number(process.env.REMOVE_PERCENT ?? '100');
  const targetTotalToken1 = Number(process.env.TARGET_TOTAL_TOKEN1 ?? '0');

  if (!privateKey) throw new Error('PRIVATE_KEY missing');
  if (!Number.isFinite(tickRange)) throw new Error('TICK_RANGE invalid');
  if (!Number.isFinite(slippageToleranceBps)) throw new Error('SLIPPAGE_BPS invalid');
  if (!Number.isFinite(rebalanceDeadlineSec)) throw new Error('REBALANCE_DEADLINE_SEC invalid');
  if (!Number.isFinite(removePercent)) throw new Error('REMOVE_PERCENT invalid');
  if (!Number.isFinite(targetTotalToken1) || targetTotalToken1 < 0) {
    throw new Error('TARGET_TOTAL_TOKEN1 invalid');
  }

  return {
    ...base,
    privateKey,
    tickRange,
    slippageToleranceBps,
    rebalanceDeadlineSec,
    removePercent,
    targetTotalToken1,
  };
}
