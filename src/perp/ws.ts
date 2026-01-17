import WebSocket from 'ws';

import { setPerpPositions } from '../state/perp';

type WsMessage = {
  type?: string;
  data?: {
    positions?: unknown[];
  };
  ts?: number;
  seq?: number;
};

const reconnectDelaysMs = [1000, 2000, 5000, 10000];

function getPerpWsUrl(): string {
  const override = process.env.PERP_WS_URL;
  if (override) return override;
  const env = (process.env.X10_ENV ?? 'MAINNET').toUpperCase();
  if (env === 'TESTNET') {
    return 'wss://api.testnet.extended.exchange/stream.extended.exchange/v1/account';
  }
  return 'wss://api.extended.exchange/stream.extended.exchange/v1/account';
}

export function startPerpAccountStream(): { stop: () => void } {
  const apiKey = process.env.X10_API_KEY ?? '';
  if (!apiKey) {
    console.warn('PERP WS disabled: X10_API_KEY missing');
    return { stop: () => undefined };
  }

  let stopped = false;
  let retry = 0;
  let socket: WebSocket | null = null;

  const connect = () => {
    if (stopped) return;
    const url = getPerpWsUrl();
    socket = new WebSocket(url, {
      headers: { 'X-Api-Key': apiKey },
    });

    socket.on('open', () => {
      retry = 0;
      console.log(`PERP WS connected: ${url}`);
    });

    socket.on('ping', () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.pong();
      }
    });

    socket.on('message', (data: WebSocket.RawData) => {
      try {
        const text = typeof data === 'string' ? data : data.toString();
        const message = JSON.parse(text) as WsMessage;
        if (message.type === 'POSITION' && message.data?.positions) {
          setPerpPositions({
            positions: message.data.positions,
            ts: message.ts ?? Date.now(),
            seq: message.seq,
          });
        }
      } catch (error) {
        console.warn('PERP WS parse error:', error);
      }
    });

    socket.on('close', () => {
      if (stopped) return;
      const delay = reconnectDelaysMs[Math.min(retry, reconnectDelaysMs.length - 1)];
      retry += 1;
      console.warn(`PERP WS disconnected. Reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    });

    socket.on('error', (error: Error) => {
      console.warn('PERP WS error:', error);
    });
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    },
  };
}
