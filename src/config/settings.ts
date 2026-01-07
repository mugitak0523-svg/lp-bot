import 'dotenv/config';

export type Settings = {
  rpcUrl: string;
  rpcWss: string;
  tokenId: string;
  poolAddress: string;
  chainId: number;
  updateIntervalMs: number;
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
