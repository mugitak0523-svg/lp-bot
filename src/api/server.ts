import express from 'express';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { ethers } from 'ethers';
import { Pool } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';

import IERC20_METADATA_ABI from '@uniswap/v3-periphery/artifacts/contracts/interfaces/IERC20Metadata.sol/IERC20Metadata.json';
import PoolABI from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';

import { getConfig, getLogs, getSnapshot, updateConfig } from '../state/store';
import { deletePositionsByTokenIds, getLatestActivePosition, getLatestPosition, listPositions } from '../db/positions';
import { getDb } from '../db/sqlite';
import { loadSettings } from '../config/settings';
import { createHttpProvider } from '../utils/provider';

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

  app.get('/wallet/balances', async (_req, res) => {
    const ownerAddressEnv = process.env.OWNER_ADDRESS ?? '';
    const privateKey = process.env.PRIVATE_KEY ?? '';
    const ownerAddress = ownerAddressEnv || (privateKey ? new ethers.Wallet(privateKey).address : '');
    if (!ownerAddress) {
      res.status(400).json({ error: 'OWNER_ADDRESS or PRIVATE_KEY required' });
      return;
    }
    try {
      const settings = loadSettings();
      const provider = createHttpProvider(settings.rpcUrl);
      const pool = new ethers.Contract(settings.poolAddress, PoolABI.abi, provider);
      const [token0Address, token1Address, slot0, liquidity, fee] = await Promise.all([
        pool.token0(),
        pool.token1(),
        pool.slot0(),
        pool.liquidity(),
        pool.fee(),
      ]);
      const token0 = new ethers.Contract(token0Address, IERC20_METADATA_ABI.abi, provider);
      const token1 = new ethers.Contract(token1Address, IERC20_METADATA_ABI.abi, provider);
      const [dec0, dec1, sym0, sym1, bal0, bal1, nativeBal] = await Promise.all([
        token0.decimals(),
        token1.decimals(),
        token0.symbol(),
        token1.symbol(),
        token0.balanceOf(ownerAddress),
        token1.balanceOf(ownerAddress),
        provider.getBalance(ownerAddress),
      ]);
      const balance0 = Number(ethers.utils.formatUnits(bal0, dec0));
      const balance1 = Number(ethers.utils.formatUnits(bal1, dec1));
      const nativeBalance = Number(ethers.utils.formatEther(nativeBal));
      let prices = await fetchCoingeckoPrices(token0Address, token1Address);
      if (!prices.token0Usd && !prices.token1Usd && !prices.nativeUsd) {
        prices = {
          ...(await fetchPoolFallbackPrices(
            settings.chainId,
            token0Address,
            token1Address,
            dec0,
            dec1,
            sym0,
            sym1,
            fee,
            slot0,
            liquidity
          )),
        };
      }
      res.json({
        owner: ownerAddress,
        token0: { address: token0Address, symbol: sym0, decimals: dec0, balance: balance0, usdPrice: prices.token0Usd },
        token1: { address: token1Address, symbol: sym1, decimals: dec1, balance: balance1, usdPrice: prices.token1Usd },
        native: { symbol: 'ETH', balance: nativeBalance, usdPrice: prices.nativeUsd },
        priceSource: prices.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
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

type PriceResult = {
  token0Usd: number | null;
  token1Usd: number | null;
  nativeUsd: number | null;
  source: string | null;
};

async function fetchCoingeckoPrices(token0: string, token1: string): Promise<PriceResult> {
  try {
    const [token0Usd, token1Usd] = await Promise.all([
      fetchTokenUsd(token0),
      fetchTokenUsd(token1),
    ]);
    const nativeData = await fetchJsonGet(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
    );
    const nativeUsd = nativeData?.ethereum?.usd ?? null;
    return { token0Usd, token1Usd, nativeUsd, source: 'coingecko' };
  } catch (error) {
    return { token0Usd: null, token1Usd: null, nativeUsd: null, source: null };
  }
}

async function fetchTokenUsd(address: string): Promise<number | null> {
  try {
    const tokenUrl =
      `https://api.coingecko.com/api/v3/simple/token_price/arbitrum-one?contract_addresses=${address.toLowerCase()}&vs_currencies=usd`;
    const tokenData = await fetchJsonGet(tokenUrl);
    return tokenData?.[address.toLowerCase()]?.usd ?? null;
  } catch (error) {
    return null;
  }
}

function fetchJsonGet(urlString: string): Promise<any> {
  const url = new URL(urlString);
  const apiKey = process.env.COINGECKO_API_KEY ?? '';
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`));
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
    req.end();
  });
}

function isUsdStable(symbol: string): boolean {
  const normalized = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return normalized.includes('USD') || normalized === 'DAI';
}

function isWethLike(symbol: string): boolean {
  const normalized = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return normalized === 'WETH' || normalized === 'ETH';
}

async function fetchPoolFallbackPrices(
  chainId: number,
  token0Address: string,
  token1Address: string,
  dec0: number,
  dec1: number,
  sym0: string,
  sym1: string,
  fee: number,
  slot0: { sqrtPriceX96: ethers.BigNumber; tick: number },
  liquidity: ethers.BigNumber
): Promise<PriceResult> {
  try {
    const token0 = new Token(chainId, token0Address, dec0, sym0);
    const token1 = new Token(chainId, token1Address, dec1, sym1);
    const pool = new Pool(
      token0,
      token1,
      fee,
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      slot0.tick
    );
    const price0In1 = Number(pool.token0Price.toSignificant(8));
    const token1Stable = isUsdStable(sym1);
    const token0Stable = isUsdStable(sym0);
    const token0Weth = isWethLike(sym0);
    const token1Weth = isWethLike(sym1);

    let token0Usd: number | null = null;
    let token1Usd: number | null = null;
    let nativeUsd: number | null = null;

    if (token1Stable) {
      token0Usd = price0In1;
      token1Usd = 1;
      if (token0Weth) nativeUsd = token0Usd;
    } else if (token0Stable && price0In1 > 0) {
      token0Usd = 1;
      token1Usd = 1 / price0In1;
      if (token1Weth) nativeUsd = token1Usd;
    }

    return { token0Usd, token1Usd, nativeUsd, source: 'pool' };
  } catch (error) {
    return { token0Usd: null, token1Usd: null, nativeUsd: null, source: null };
  }
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
