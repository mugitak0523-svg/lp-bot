import { ethers } from 'ethers';

export type HybridProvider = {
  http: ethers.providers.JsonRpcProvider;
  ws: ethers.providers.WebSocketProvider;
};

export function createHybridProvider(rpcUrl: string, rpcWss: string): HybridProvider {
  return {
    http: new ethers.providers.JsonRpcProvider(rpcUrl),
    ws: new ethers.providers.WebSocketProvider(rpcWss),
  };
}
