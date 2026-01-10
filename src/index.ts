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
import { clearSnapshot, getConfig, MonitorSnapshot, setSnapshot } from './state/store';
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
  const config = getConfig();
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
    swapFeeIn1: result.swapFeeIn1,
    configTickRange: config.tickRange,
    configRebalanceDelaySec: config.rebalanceDelaySec,
    configSlippageBps: config.slippageBps,
    configStopLossPercent: config.stopLossPercent,
    configMaxGasPriceGwei: config.maxGasPriceGwei,
    configTargetTotalToken1: config.targetTotalToken1,
    configStopAfterAutoClose: config.stopAfterAutoClose ? 1 : 0,
    rebalanceReason: result.reason,
    mintTxHash: result.mintTxHash,
    closeTxHash: undefined,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
}

async function handleSnapshot(snapshot: MonitorSnapshot) {
  const config = getConfig();

  if (!state.initialNetValue) {
    const active = await getLatestActivePosition(db);
    if (active?.netValueIn1) {
      state.initialNetValue = active.netValueIn1;
    } else {
      state.initialNetValue = snapshot.netValueIn1;
    }
  }

  const isLiquidityZero = snapshot.liquidity === '0';
  const outOfRange =
    !isLiquidityZero && (snapshot.currentTick < snapshot.tickLower || snapshot.currentTick > snapshot.tickUpper);
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
  const remainingMs = outOfRange && state.outOfRangeSince > 0 ? Math.max(0, delayMs - (now - state.outOfRangeSince)) : null;
  const remainingSec = remainingMs == null ? null : Math.ceil(remainingMs / 1000);

  setSnapshot({
    ...snapshot,
    outOfRange,
    outOfRangeStartAt: state.outOfRangeSince ? new Date(state.outOfRangeSince).toISOString() : null,
    rebalanceRemainingSec: remainingSec,
  });

  const stopLossLine = state.initialNetValue * (1 - config.stopLossPercent / 100);
  if (!state.rebalancing && !isLiquidityZero && snapshot.netValueIn1 <= stopLossLine) {
    state.rebalancing = true;
    sendDiscordMessage(
      webhookUrl,
      `STOP LOSS triggered. Net=${snapshot.netValueIn1.toFixed(4)} ${snapshot.symbol1} <= ${stopLossLine.toFixed(4)}`,
      'error'
    );
    try {
      const active = await getLatestActivePosition(db);
      const tokenId = active?.tokenId ?? settings.tokenId;
      const result = await closePosition({ removePercent: 100, tokenId });
      if (active?.tokenId) {
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closeReason: 'stop_loss',
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
    if (config.stopAfterAutoClose) {
      state.rebalancing = true;
      sendDiscordMessage(webhookUrl, 'Auto close (no rebalance) start.', 'warn');
      try {
        const active = await getLatestActivePosition(db);
        if (!active) {
          throw new Error('active position not found');
        }
        const result = await closePosition({ removePercent: 100, tokenId: active.tokenId });
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closeReason: 'auto_close_no_rebalance',
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          closedAt: new Date().toISOString(),
        };
        await closePositionWithDetails(db, active.tokenId, details);
        await maybeStopMonitor();
        sendDiscordMessage(webhookUrl, 'Auto close done. Monitoring stopped.', 'success');
      } catch (error) {
        console.error('Auto close error:', error);
        sendDiscordMessage(webhookUrl, `Auto close error: ${error}`, 'error');
      } finally {
        state.rebalancing = false;
        state.outOfRangeSince = 0;
      }
      return;
    }
    const gasPrice = await httpProvider.getGasPrice();
    const gasGwei = Number(ethers.utils.formatUnits(gasPrice, 'gwei'));
    if (gasGwei > config.maxGasPriceGwei) {
      console.log(`Skip rebalance: gas ${gasGwei.toFixed(1)} gwei > ${config.maxGasPriceGwei}`);
      return;
    }

    state.rebalancing = true;
    sendDiscordMessage(webhookUrl, `Rebalance start. Tick=${snapshot.currentTick}`, 'warn');

    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      const direction = snapshot.currentTick > snapshot.tickUpper ? 'upper' : 'lower';
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
          closeReason: `rebalance_auto(${direction})`,
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
      await startMonitorFor(result.tokenId, result.netValueIn1);
      sendDiscordMessage(webhookUrl, 'Rebalance done.', 'success');
    } catch (error) {
      console.error('Rebalance error:', error);
      sendDiscordMessage(webhookUrl, `Rebalance error: ${error}`, 'error');
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
    sendDiscordMessage(webhookUrl, 'Manual rebalance start.', 'warn');
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
          closeReason: 'rebalance_manual',
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
      await startMonitorFor(result.tokenId, result.netValueIn1);
      sendDiscordMessage(webhookUrl, 'Manual rebalance done.', 'success');
    } catch (error) {
      console.error('Manual rebalance error:', error);
      sendDiscordMessage(webhookUrl, `Manual rebalance error: ${error}`, 'error');
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
    sendDiscordMessage(webhookUrl, 'Manual close start.', 'warn');
    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      const result = await closePosition({ removePercent: 100, tokenId: active.tokenId });
      const details: CloseDetails = {
        closeTxHash: result.closeTxHash,
        closeReason: 'manual_close',
        closedNetValueIn1: result.closedNetValueIn1,
        realizedFeesIn1: result.closedFeesIn1,
        realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
        closedAt: new Date().toISOString(),
      };
      await closePositionWithDetails(db, active.tokenId, details);
      await maybeStopMonitor();
      sendDiscordMessage(webhookUrl, 'Manual close done.', 'success');
    } catch (error) {
      console.error('Manual close error:', error);
      sendDiscordMessage(webhookUrl, `Manual close error: ${error}`, 'error');
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
    sendDiscordMessage(webhookUrl, 'Manual mint start.', 'warn');
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
      await startMonitorFor(result.tokenId, result.netValueIn1);
      sendDiscordMessage(webhookUrl, 'Manual mint done.', 'success');
    } catch (error) {
      console.error('Manual mint error:', error);
      sendDiscordMessage(webhookUrl, `Manual mint error: ${error}`, 'error');
      throw error;
    } finally {
      state.rebalancing = false;
    }
  },
};
async function startMonitorFor(tokenId: string, initialNetValue?: number): Promise<void> {
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
      { tokenId, initialNetValue }
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

  await startMonitorFor(active.tokenId, active.netValueIn1);
}

async function maybeStopMonitor(): Promise<void> {
  const active = await getLatestActivePosition(db);
  if (active) return;
  if (state.monitorController) {
    state.monitorController.stop();
    state.monitorController = null;
    state.monitorTokenId = null;
    state.monitoring = false;
    clearSnapshot();
    console.log('No active position. Monitor stopped.');
  }
}

async function bootstrap(): Promise<void> {
  await awaitDbReady();
  startApiServer(port, apiActions);
  await maybeStartMonitor();
}

void bootstrap();
