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

function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(digits);
}

function formatSigned(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

function formatGasNative(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(18);
  return fixed.replace(/\.?0+$/, '');
}

function mergeGasCost(
  active: Awaited<ReturnType<typeof getLatestActivePosition>> | null,
  deltaNative: string,
  deltaIn1: number
): { gasCostNative: string; gasCostIn1: number } {
  const baseNative = active?.gasCostNative ? parseFloat(active.gasCostNative) : 0;
  const baseIn1 = active?.gasCostIn1 ?? 0;
  const addNative = Number.isFinite(parseFloat(deltaNative)) ? parseFloat(deltaNative) : 0;
  const addIn1 = Number.isFinite(deltaIn1) ? deltaIn1 : 0;
  const totalNative = baseNative + addNative;
  const totalIn1 = baseIn1 + addIn1;
  return { gasCostNative: formatGasNative(totalNative), gasCostIn1: totalIn1 };
}

function buildCloseSummary(params: {
  title: string;
  tokenId: string;
  pool?: string;
  symbol1?: string;
  price0In1?: number | null;
  closedNetValueIn1?: number | null;
  realizedFeesIn1?: number | null;
  realizedPnlIn1?: number | null;
  gasCostIn1?: number | null;
  swapFeeIn1?: number | null;
  closeReason?: string | null;
  closeTxHash?: string | null;
}): string {
  const symbol1 = params.symbol1 ?? '';
  const toNumber = (value: number | null | undefined): number =>
    value != null && Number.isFinite(value) ? value : 0;
  const profitParts = [
    toNumber(params.realizedPnlIn1),
    toNumber(params.realizedFeesIn1),
    -toNumber(params.gasCostIn1),
    -toNumber(params.swapFeeIn1),
  ];
  const profitTotal = profitParts.reduce((acc, value) => acc + value, 0);
  return [
    params.title,
    `Token: ${params.tokenId}${params.pool ? ` (${params.pool})` : ''}`,
    params.closeReason ? `Reason: ${params.closeReason}` : null,
    params.price0In1 != null ? `Close Price: ${formatNumber(params.price0In1, 4)} ${symbol1}` : null,
    params.closedNetValueIn1 != null ? `Close Net: ${formatNumber(params.closedNetValueIn1, 4)} ${symbol1}` : null,
    params.realizedFeesIn1 != null ? `Fees: ${formatSigned(params.realizedFeesIn1, 4)} ${symbol1}` : null,
    params.realizedPnlIn1 != null ? `PnL: ${formatSigned(params.realizedPnlIn1, 4)} ${symbol1}` : null,
    params.gasCostIn1 != null ? `Gas: -${formatNumber(params.gasCostIn1, 4)} ${symbol1}` : null,
    params.swapFeeIn1 != null ? `Swap Fee: -${formatNumber(params.swapFeeIn1, 4)} ${symbol1}` : null,
    `Profit: ${formatSigned(profitTotal, 4)} ${symbol1}`.trim(),
    params.closeTxHash ? `Tx: ${params.closeTxHash}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function buildRebalanceSummary(params: {
  title: string;
  oldTokenId: string;
  newTokenId: string;
  pool?: string;
  symbol1?: string;
  price0In1?: number | null;
  closedNetValueIn1?: number | null;
  realizedFeesIn1?: number | null;
  realizedPnlIn1?: number | null;
  gasCostIn1?: number | null;
  swapFeeIn1?: number | null;
  closeReason?: string | null;
  closeTxHash?: string | null;
  newRange?: string | null;
  newSizeIn1?: number | null;
  mintTxHash?: string | null;
}): string {
  const base = buildCloseSummary({
    title: params.title,
    tokenId: params.oldTokenId,
    pool: params.pool,
    symbol1: params.symbol1,
    price0In1: params.price0In1,
    closedNetValueIn1: params.closedNetValueIn1,
    realizedFeesIn1: params.realizedFeesIn1,
    realizedPnlIn1: params.realizedPnlIn1,
    gasCostIn1: params.gasCostIn1,
    swapFeeIn1: params.swapFeeIn1,
    closeReason: params.closeReason,
    closeTxHash: params.closeTxHash,
  });
  return [
    base,
    `New Token: ${params.newTokenId}`,
    params.newRange ? `New Range: ${params.newRange}` : null,
    params.newSizeIn1 != null ? `New Size: ${formatNumber(params.newSizeIn1, 4)} ${params.symbol1 ?? ''}` : null,
    params.mintTxHash ? `Mint Tx: ${params.mintTxHash}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function resolveActiveConfig(active: Awaited<ReturnType<typeof getLatestActivePosition>>) {
  const fallback = getConfig();
  return {
    tickRange: active?.configTickRange ?? fallback.tickRange,
    rebalanceDelaySec: active?.configRebalanceDelaySec ?? fallback.rebalanceDelaySec,
    slippageBps: active?.configSlippageBps ?? fallback.slippageBps,
    stopLossPercent: active?.configStopLossPercent ?? fallback.stopLossPercent,
    maxGasPriceGwei: active?.configMaxGasPriceGwei ?? fallback.maxGasPriceGwei,
    targetTotalToken1: active?.configTargetTotalToken1 ?? fallback.targetTotalToken1,
    stopAfterAutoClose:
      active?.configStopAfterAutoClose != null ? Boolean(active.configStopAfterAutoClose) : fallback.stopAfterAutoClose,
  };
}

function toPositionRecord(result: RebalanceResult, configOverride?: ReturnType<typeof resolveActiveConfig>) {
  const now = new Date().toISOString();
  const config = configOverride ?? getConfig();
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
  const activeForConfig = await getLatestActivePosition(db);
  const config = resolveActiveConfig(activeForConfig);

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
        const mergedGas = mergeGasCost(active, result.gasCostNative, result.gasCostIn1);
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closeReason: 'stop_loss',
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          gasCostNative: mergedGas.gasCostNative,
          gasCostIn1: mergedGas.gasCostIn1,
          closedAt: new Date().toISOString(),
        };
        await closePositionWithDetails(db, active.tokenId, details);
        sendDiscordMessage(
          webhookUrl,
          buildCloseSummary({
            title: 'Stop Loss Close',
            tokenId: active.tokenId,
            pool: `${active.token0Symbol}/${active.token1Symbol}`,
            symbol1: active.token1Symbol,
            price0In1: result.price0In1,
            closedNetValueIn1: details.closedNetValueIn1,
            realizedFeesIn1: details.realizedFeesIn1,
            realizedPnlIn1: details.realizedPnlIn1,
            gasCostIn1: details.gasCostIn1,
            swapFeeIn1: active.swapFeeIn1,
            closeReason: details.closeReason,
            closeTxHash: details.closeTxHash,
          }),
          'error'
        );
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
      try {
        const active = activeForConfig;
        if (!active) {
          throw new Error('active position not found');
        }
        sendDiscordMessage(
          webhookUrl,
          `Auto close start.\nToken: ${active.tokenId} (${active.token0Symbol}/${active.token1Symbol})`,
          'warn'
        );
        const result = await closePosition({ removePercent: 100, tokenId: active.tokenId });
        const mergedGas = mergeGasCost(active, result.gasCostNative, result.gasCostIn1);
        const details: CloseDetails = {
          closeTxHash: result.closeTxHash,
          closeReason: 'auto_close_no_rebalance',
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          gasCostNative: mergedGas.gasCostNative,
          gasCostIn1: mergedGas.gasCostIn1,
          closedAt: new Date().toISOString(),
        };
        await closePositionWithDetails(db, active.tokenId, details);
        await maybeStopMonitor();
        sendDiscordMessage(
          webhookUrl,
          buildCloseSummary({
            title: 'Auto Close Done',
            tokenId: active.tokenId,
            pool: `${active.token0Symbol}/${active.token1Symbol}`,
            symbol1: active.token1Symbol,
            price0In1: result.price0In1,
            closedNetValueIn1: details.closedNetValueIn1,
            realizedFeesIn1: details.realizedFeesIn1,
            realizedPnlIn1: details.realizedPnlIn1,
            gasCostIn1: details.gasCostIn1,
            swapFeeIn1: active.swapFeeIn1,
            closeReason: details.closeReason,
            closeTxHash: details.closeTxHash,
          }),
          'success'
        );
        // Detailed summary already sent above.
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

    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      const rebalanceConfig = resolveActiveConfig(active);
      sendDiscordMessage(
        webhookUrl,
        `Rebalance start.\nToken: ${active.tokenId} (${active.token0Symbol}/${active.token1Symbol})\nTick: ${snapshot.currentTick}`,
        'warn'
      );
      const direction = snapshot.currentTick > snapshot.tickUpper ? 'upper' : 'lower';
      const result = await runRebalance(
        {
          tokenId: active.tokenId,
          tickRange: rebalanceConfig.tickRange,
          slippageToleranceBps: rebalanceConfig.slippageBps,
          targetTotalToken1: rebalanceConfig.targetTotalToken1,
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
      await insertPosition(db, toPositionRecord(result, rebalanceConfig));
      await startMonitorFor(result.tokenId, result.netValueIn1);
      sendDiscordMessage(
        webhookUrl,
        buildRebalanceSummary({
          title: 'Rebalance Done',
          oldTokenId: active.tokenId,
          newTokenId: result.tokenId,
          pool: `${active.token0Symbol}/${active.token1Symbol}`,
          symbol1: active.token1Symbol,
          price0In1: result.price0In1,
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          gasCostIn1: result.gasCostIn1,
          swapFeeIn1: result.swapFeeIn1,
          closeReason: `rebalance_auto(${direction})`,
          closeTxHash: result.closeTxHash,
          newRange: `${result.tickLower} ~ ${result.tickUpper}`,
          newSizeIn1: result.netValueIn1,
          mintTxHash: result.mintTxHash,
        }),
        'success'
      );
      // Detailed summary already sent above.
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
    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      sendDiscordMessage(
        webhookUrl,
        `Manual rebalance start.\nToken: ${active.tokenId} (${active.token0Symbol}/${active.token1Symbol})`,
        'warn'
      );
      const rebalanceConfig = resolveActiveConfig(active);
      const result = await runRebalance(
        {
          tokenId: active.tokenId,
          tickRange: rebalanceConfig.tickRange,
          slippageToleranceBps: rebalanceConfig.slippageBps,
          targetTotalToken1: rebalanceConfig.targetTotalToken1,
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
      await insertPosition(db, toPositionRecord(result, rebalanceConfig));
      await startMonitorFor(result.tokenId, result.netValueIn1);
      sendDiscordMessage(
        webhookUrl,
        buildRebalanceSummary({
          title: 'Manual Rebalance Done',
          oldTokenId: active.tokenId,
          newTokenId: result.tokenId,
          pool: `${active.token0Symbol}/${active.token1Symbol}`,
          symbol1: active.token1Symbol,
          price0In1: result.price0In1,
          closedNetValueIn1: result.closedNetValueIn1,
          realizedFeesIn1: result.closedFeesIn1,
          realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
          gasCostIn1: result.gasCostIn1,
          swapFeeIn1: result.swapFeeIn1,
          closeReason: 'rebalance_manual',
          closeTxHash: result.closeTxHash,
          newRange: `${result.tickLower} ~ ${result.tickUpper}`,
          newSizeIn1: result.netValueIn1,
          mintTxHash: result.mintTxHash,
        }),
        'success'
      );
      // Detailed summary already sent above.
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
    try {
      const active = await getLatestActivePosition(db);
      if (!active) {
        throw new Error('active position not found');
      }
      sendDiscordMessage(
        webhookUrl,
        `Manual close start.\nToken: ${active.tokenId} (${active.token0Symbol}/${active.token1Symbol})`,
        'warn'
      );
      const result = await closePosition({ removePercent: 100, tokenId: active.tokenId });
      const mergedGas = mergeGasCost(active, result.gasCostNative, result.gasCostIn1);
      const details: CloseDetails = {
        closeTxHash: result.closeTxHash,
        closeReason: 'manual_close',
        closedNetValueIn1: result.closedNetValueIn1,
        realizedFeesIn1: result.closedFeesIn1,
        realizedPnlIn1: result.closedNetValueIn1 - active.netValueIn1,
        gasCostNative: mergedGas.gasCostNative,
        gasCostIn1: mergedGas.gasCostIn1,
        closedAt: new Date().toISOString(),
      };
      await closePositionWithDetails(db, active.tokenId, details);
      await maybeStopMonitor();
      sendDiscordMessage(
        webhookUrl,
        buildCloseSummary({
          title: 'Manual Close Done',
          tokenId: active.tokenId,
          pool: `${active.token0Symbol}/${active.token1Symbol}`,
          symbol1: active.token1Symbol,
          price0In1: result.price0In1,
          closedNetValueIn1: details.closedNetValueIn1,
          realizedFeesIn1: details.realizedFeesIn1,
          realizedPnlIn1: details.realizedPnlIn1,
          gasCostIn1: details.gasCostIn1,
          swapFeeIn1: active.swapFeeIn1,
          closeReason: details.closeReason,
          closeTxHash: details.closeTxHash,
        }),
        'success'
      );
      // Detailed summary already sent above.
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
