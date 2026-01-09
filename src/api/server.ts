import express from 'express';
import https from 'https';
import path from 'path';
import { URL } from 'url';

import { getConfig, getLogs, getSnapshot, updateConfig } from '../state/store';
import { deletePositionsByTokenIds, getLatestActivePosition, getLatestPosition, listPositions } from '../db/positions';
import { getDb } from '../db/sqlite';

export type ApiActions = {
  rebalance?: () => Promise<void>;
  close?: () => Promise<void>;
  mint?: () => Promise<void>;
};

export function startApiServer(port: number, actions: ApiActions = {}): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve(process.cwd(), 'web')));
  const db = getDb();

  app.get('/status', (_req, res) => {
    const snapshot = getSnapshot();
    if (!snapshot) {
      res.json({ status: 'no-data' });
      return;
    }
    res.json(snapshot);
  });

  app.get('/chart', async (req, res) => {
    const interval = req.query.interval === 'day' ? 'day' : 'hour';
    const limit = Number(req.query.limit ?? 96);
    const poolAddress = (process.env.POOL_ADDRESS ?? '').toLowerCase();
    const chainId = Number(process.env.CHAIN_ID ?? '42161');

    if (!poolAddress) {
      res.status(400).json({ error: 'POOL_ADDRESS missing' });
      return;
    }

    const subgraphUrl = getSubgraphUrl(chainId);
    if (!subgraphUrl) {
      res.status(400).json({ error: `Unsupported CHAIN_ID ${chainId}` });
      return;
    }

    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 10), 500) : 96;
    const entity = interval === 'day' ? 'poolDayDatas' : 'poolHourDatas';
    const query = `
      query($pool: String!, $limit: Int!) {
        ${entity}(first: $limit, orderBy: periodStartUnix, orderDirection: desc, where: { pool: $pool }) {
          periodStartUnix
          token0Price
        }
      }
    `;

    try {
      const data = await fetchGraphql(subgraphUrl, query, { pool: poolAddress, limit: safeLimit });
      if (data?.errors?.length) {
        throw new Error(data.errors.map((err: { message: string }) => err.message).join('; '));
      }
      const rows = data?.data?.[entity] ?? [];
      const points = rows
        .map((row: { periodStartUnix: string; token0Price: string }) => ({
          time: Number(row.periodStartUnix),
          price: Number(row.token0Price),
        }))
        .filter((row: { time: number; price: number }) => Number.isFinite(row.time) && Number.isFinite(row.price))
        .sort((a: { time: number }, b: { time: number }) => a.time - b.time);
      if (points.length === 0) {
        const poolQuery = `
          query($pool: String!) {
            pool(id: $pool) {
              id
              token0Price
              token1Price
            }
          }
        `;
        const poolData = await fetchGraphql(subgraphUrl, poolQuery, { pool: poolAddress });
        const pool = poolData?.data?.pool ?? null;
        const meta = pool
          ? 'No historical data for this pool yet.'
          : 'Pool not found in subgraph.';
        res.json({ interval, points: [], meta });
        return;
      }
      res.json({ interval, points });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error('Chart fetch failed:', message);
      res.status(500).json({ error: `chart fetch failed: ${message}` });
    }
  });

  app.get('/config', (_req, res) => {
    res.json(getConfig());
  });

  app.get('/logs', (req, res) => {
    const limit = Number(req.query.limit ?? '50');
    res.json(getLogs(Number.isFinite(limit) ? limit : 50));
  });

  app.post('/config', (req, res) => {
    const body = req.body ?? {};
    const next = updateConfig({
      tickRange: typeof body.tickRange === 'number' ? body.tickRange : undefined,
      rebalanceDelaySec: typeof body.rebalanceDelaySec === 'number' ? body.rebalanceDelaySec : undefined,
      slippageBps: typeof body.slippageBps === 'number' ? body.slippageBps : undefined,
      stopLossPercent: typeof body.stopLossPercent === 'number' ? body.stopLossPercent : undefined,
      maxGasPriceGwei: typeof body.maxGasPriceGwei === 'number' ? body.maxGasPriceGwei : undefined,
      targetTotalToken1: typeof body.targetTotalToken1 === 'number' ? body.targetTotalToken1 : undefined,
    });
    res.json(next);
  });

  app.get('/positions', async (req, res) => {
    const limit = Number(req.query.limit ?? '50');
    const rows = await listPositions(db, Number.isFinite(limit) ? limit : 50);
    res.json(rows);
  });

  app.post('/positions/delete', async (req, res) => {
    const tokenIds = Array.isArray(req.body?.tokenIds) ? req.body.tokenIds : [];
    const sanitized = tokenIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0);
    if (sanitized.length === 0) {
      res.status(400).json({ error: 'tokenIds required' });
      return;
    }
    const deleted = await deletePositionsByTokenIds(db, sanitized);
    res.json({ deleted });
  });

  app.get('/positions/latest', async (_req, res) => {
    const row = await getLatestPosition(db);
    if (!row) {
      res.json({ status: 'no-data' });
      return;
    }
    res.json(row);
  });

  app.get('/positions/active', async (_req, res) => {
    const row = await getLatestActivePosition(db);
    if (!row) {
      res.json({ status: 'no-data' });
      return;
    }
    res.json(row);
  });

  app.post('/action/rebalance', (_req, res) => {
    if (!actions.rebalance) {
      res.status(501).json({ error: 'rebalance not configured' });
      return;
    }
    void actions.rebalance();
    res.json({ status: 'accepted' });
  });

  app.post('/action/close', (_req, res) => {
    if (!actions.close) {
      res.status(501).json({ error: 'close not configured' });
      return;
    }
    void actions.close();
    res.json({ status: 'accepted' });
  });

  app.post('/action/mint', async (_req, res) => {
    if (!actions.mint) {
      res.status(501).json({ error: 'mint not configured' });
      return;
    }
    try {
      await actions.mint();
      res.json({ status: 'ok' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('active position') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });


  app.listen(port, () => {
    console.log(`API server listening on :${port}`);
  });
}

function getSubgraphUrl(chainId: number): string | null {
  const apiKey = process.env.GRAPH_API_KEY ?? '';
  const subgraphId = process.env.SUBGRAPH_ID ?? '';
  if (apiKey && subgraphId) {
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
  }
  switch (chainId) {
    case 1:
      return 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';
    case 42161:
      return 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-arbitrum';
    case 10:
      return 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-optimism';
    case 137:
      return 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon';
    default:
      return null;
  }
}

function fetchGraphql(
  urlString: string,
  query: string,
  variables: Record<string, unknown>,
  redirectsLeft = 2
): Promise<any> {
  const url = new URL(urlString);
  const body = JSON.stringify({ query, variables });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (
            redirectsLeft > 0 &&
            res.statusCode &&
            [301, 302, 307, 308].includes(res.statusCode) &&
            res.headers.location
          ) {
            const nextUrl = new URL(res.headers.location, url);
            fetchGraphql(nextUrl.toString(), query, variables, redirectsLeft - 1)
              .then(resolve)
              .catch(reject);
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            const snippet = data.slice(0, 200).replace(/\s+/g, ' ');
            reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}: ${snippet}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
