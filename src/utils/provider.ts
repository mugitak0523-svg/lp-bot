import { ethers } from 'ethers';

export type HybridProvider = {
  http: ethers.providers.JsonRpcProvider;
  ws: ethers.providers.WebSocketProvider;
};

export function createHttpProvider(rpcUrl: string): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(rpcUrl);
}

export function createWsProvider(rpcWss: string): ethers.providers.WebSocketProvider {
  return new ethers.providers.WebSocketProvider(rpcWss);
}

export function createHybridProvider(rpcUrl: string, rpcWss: string): HybridProvider {
  return {
    http: createHttpProvider(rpcUrl),
    ws: createWsProvider(rpcWss),
  };
}
