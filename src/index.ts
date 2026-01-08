import 'dotenv/config';

import { startApiServer } from './api/server';
import { ethers } from 'ethers';

import { MonitorController, startMonitor } from './bot/monitor';
import { RebalanceResult, closePosition, mintNewPosition, runRebalance } from './bot/rebalance';
import {
  CloseDetails,
  closeLatestActivePosition,
  closeLatestPosition,
  closePositionWithDetails,
  getLatestActivePosition,
  insertPosition,
} from './db/positions';
import { awaitDbReady, initDb } from './db/sqlite';
import { loadSettings } from './config/settings';
import { getConfig, MonitorSnapshot, setSnapshot } from './state/store';
import { sendDiscordMessage } from './utils/discord';
import { createHttpProvider } from './utils/provider';

const port = Number(process.env.PORT ?? '3000');
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const sqlitePath = process.env.SQLITE_PATH ?? './data/lpbot.db';
const db = initDb(sqlitePath);
const settings = loadSettings();
const httpProvider = createHttpProvider(settings.rpcUrl);

const state = {
  outOfRangeSince: 0,
  rebalancing: false,
  initialNetValue: 0,
  monitoring: false,
  monitorTokenId: null as string | null,
  monitorController: null as MonitorController | null,
};

function toPositionRecord(result: RebalanceResult) {
  const now = new Date().toISOString();
  return {
    tokenId: result.tokenId,
    poolAddress: result.poolAddress,
    token0Address: result.token0Address,
    token0Symbol: result.token0Symbol,
    token0Decimals: result.token0Decimals,
    token1Address: result.token1Address,
    token1Symbol: result.token1Symbol,
    token1Decimals: result.token1Decimals,
    fee: result.fee,
    tickLower: result.tickLower,
    tickUpper: result.tickUpper,
    liquidity: result.liquidity,
    amount0: result.amount0,
    amount1: result.amount1,
    price0In1: result.price0In1,
    netValueIn1: result.netValueIn1,
    fees0: result.fees0,
    fees1: result.fees1,
    gasCostNative: result.gasCostNative,
    gasCostIn1: result.gasCostIn1,
    rebalanceReason: result.reason,
    mintTxHash: result.mintTxHash,
    closeTxHash: undefined,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
}

async function handleSnapshot(snapshot: MonitorSnapshot) {
  setSnapshot(snapshot);
  const config = getConfig();

  if (!state.initialNetValue) {
    const active = await getLatestActivePosition(db);
    if (active?.netValueIn1) {
      state.initialNetValue = active.netValueIn1;
    } else {
      state.initialNetValue = snapshot.netValueIn1;
    }
  }

  const outOfRange = snapshot.currentTick < snapshot.tickLower || snapshot.currentTick > snapshot.tickUpper;
  if (outOfRange) {
    if (!state.outOfRangeSince) {
      state.outOfRangeSince = Date.now();
    }
  } else {
    state.outOfRangeSince = 0;
  }

  const now = Date.now();
  const delayMs = config.rebalanceDelaySec * 1000;
  const shouldRebalance = outOfRange && state.outOfRangeSince > 0 && now - state.outOfRangeSince >= delayMs;

  const stopLossLine = state.initialNetValue * (1 - config.stopLossPercent / 100);
  if (!state.rebalancing && snapshot.netValueIn1 <= stopLossLine) {
    state.rebalancing = true;
    sendDiscordMessage(
      webhookUrl,
      `STOP LOSS triggered. Net=${snapshot.netValueIn1.toFixed(4)} ${snapshot.symbol1} <= ${stopLossLine.toFixed(4)}`
    );
    try {
      const active = await getLatestActivePosition(db);
      const tokenId = active?.tokenId ?? settings.tokenId;
      const result = await closePosition({ removePercent: 100, tokenId });
      if (active?.tokenId) {
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          closedAt: new Date().toISOString(),
        };
        await closePositionWithDetails(db, active.tokenId, details);
      } else {
        await closeLatestActivePosition(db, result.closeTxHash);
      }
      await maybeStopMonitor();
      console.error('Stop loss done. Exiting.');
      process.exit(1);
    } catch (error) {
      console.error('Stop loss error:', error);
      process.exit(1);
    }
    return;
  }

  if (!state.rebalancing && shouldRebalance) {
    const gasPrice = await httpProvider.getGasPrice();
    const gasGwei = Number(ethers.utils.formatUnits(gasPrice, 'gwei'));
    if (gasGwei > config.maxGasPriceGwei) {
      console.log(`Skip rebalance: gas ${gasGwei.toFixed(1)} gwei > ${config.maxGasPriceGwei}`);
      return;
    }

    state.rebalancing = true;
    sendDiscordMessage(webhookUrl, `Rebalance start. Tick=${snapshot.currentTick}`);

    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      const result = await runRebalance(
        {
          tokenId: active.tokenId,
          tickRange: config.tickRange,
          slippageToleranceBps: config.slippageBps,
          targetTotalToken1: config.targetTotalToken1,
        },
        'auto'
      );
      if (active) {
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          closedAt: new Date().toISOString(),
        };
        await closePositionWithDetails(db, active.tokenId, details);
      } else {
        await closeLatestActivePosition(db, result.closeTxHash);
      }
      await insertPosition(db, toPositionRecord(result));
      await startMonitorFor(result.tokenId);
      sendDiscordMessage(webhookUrl, 'Rebalance done.');
    } catch (error) {
      console.error('Rebalance error:', error);
      sendDiscordMessage(webhookUrl, `Rebalance error: ${error}`);
    } finally {
      state.rebalancing = false;
      state.outOfRangeSince = 0;
    }
  }
}

const apiActions = {
  rebalance: async () => {
    if (state.rebalancing) {
      throw new Error('Rebalance already running');
    }
    state.rebalancing = true;
    sendDiscordMessage(webhookUrl, 'Manual rebalance start.');
    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      const result = await runRebalance(
        {
          tokenId: active.tokenId,
          tickRange: getConfig().tickRange,
          slippageToleranceBps: getConfig().slippageBps,
          targetTotalToken1: getConfig().targetTotalToken1,
        },
        'manual'
      );
      if (active) {
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          closedAt: new Date().toISOString(),
        };
        await closePositionWithDetails(db, active.tokenId, details);
      } else {
        await closeLatestActivePosition(db, result.closeTxHash);
      }
      await insertPosition(db, toPositionRecord(result));
      await startMonitorFor(result.tokenId);
      sendDiscordMessage(webhookUrl, 'Manual rebalance done.');
    } catch (error) {
      console.error('Manual rebalance error:', error);
      sendDiscordMessage(webhookUrl, `Manual rebalance error: ${error}`);
      throw error;
    } finally {
      state.rebalancing = false;
      state.outOfRangeSince = 0;
    }
  },
  close: async () => {
    if (state.rebalancing) {
      throw new Error('Rebalance already running');
    }
    state.rebalancing = true;
    sendDiscordMessage(webhookUrl, 'Manual close start.');
    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      const result = await closePosition({ removePercent: 100, tokenId: active.tokenId });
      const details: CloseDetails = {
        closeTxHash: result.closeTxHash,
        closedNetValueIn1: result.closedNetValueIn1,
        realizedFeesIn1: result.closedFeesIn1,
        realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
        closedAt: new Date().toISOString(),
      };
      await closePositionWithDetails(db, active.tokenId, details);
      await maybeStopMonitor();
      sendDiscordMessage(webhookUrl, 'Manual close done.');
    } catch (error) {
      console.error('Manual close error:', error);
      sendDiscordMessage(webhookUrl, `Manual close error: ${error}`);
      throw error;
    } finally {
      state.rebalancing = false;
      state.outOfRangeSince = 0;
    }
  },
  mint: async () => {
    if (state.rebalancing) {
      throw new Error('Rebalance already running');
    }
    const active = await getLatestActivePosition(db);
    if (active && active.status === 'active') {
      throw new Error('active position already exists');
    }
    state.rebalancing = true;
    sendDiscordMessage(webhookUrl, 'Manual mint start.');
    try {
      const result = await mintNewPosition(
        {
          tickRange: getConfig().tickRange,
          slippageToleranceBps: getConfig().slippageBps,
          targetTotalToken1: getConfig().targetTotalToken1,
        },
        'manual_create'
      );
      await insertPosition(db, toPositionRecord(result));
      await startMonitorFor(result.tokenId);
      sendDiscordMessage(webhookUrl, 'Manual mint done.');
    } catch (error) {
      console.error('Manual mint error:', error);
      sendDiscordMessage(webhookUrl, `Manual mint error: ${error}`);
      throw error;
    } finally {
      state.rebalancing = false;
    }
  },
};
async function startMonitorFor(tokenId: string): Promise<void> {
  if (state.monitorController && state.monitorTokenId === tokenId) return;
  if (state.monitorController) {
    state.monitorController.stop();
    state.monitorController = null;
  }

  state.initialNetValue = 0;
  state.outOfRangeSince = 0;
  state.monitoring = true;
  try {
    state.monitorController = await startMonitor(
      {
        onSnapshot: (snapshot) => {
          void handleSnapshot(snapshot);
        },
      },
      { tokenId }
    );
    state.monitorTokenId = tokenId;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

async function maybeStartMonitor(): Promise<void> {
  const active = await getLatestActivePosition(db);
  if (!active) {
    console.log('No active position. Monitor not started.');
    return;
  }

  await startMonitorFor(active.tokenId);
}

async function maybeStopMonitor(): Promise<void> {
  const active = await getLatestActivePosition(db);
  if (active) return;
  if (state.monitorController) {
    state.monitorController.stop();
    state.monitorController = null;
    state.monitorTokenId = null;
    state.monitoring = false;
    console.log('No active position. Monitor stopped.');
  }
}

async function bootstrap(): Promise<void> {
  await awaitDbReady();
  startApiServer(port, apiActions);
  await maybeStartMonitor();
}

void bootstrap();
