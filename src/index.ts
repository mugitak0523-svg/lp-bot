import 'dotenv/config';

import { startApiServer } from './api/server';
import { ethers } from 'ethers';

import { startMonitor } from './bot/monitor';
import { closePosition, runRebalance } from './bot/rebalance';
import { loadSettings } from './config/settings';
import { getConfig, MonitorSnapshot, setSnapshot } from './state/store';
import { sendDiscordMessage } from './utils/discord';
import { createHttpProvider } from './utils/provider';

const port = Number(process.env.PORT ?? '3000');
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const httpProvider = createHttpProvider(loadSettings().rpcUrl);

const state = {
  outOfRangeSince: 0,
  rebalancing: false,
  initialNetValue: 0,
};

async function handleSnapshot(snapshot: MonitorSnapshot) {
  setSnapshot(snapshot);
  const config = getConfig();

  if (!state.initialNetValue) {
    state.initialNetValue = snapshot.netValueIn1;
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
      await closePosition({ removePercent: 100 });
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
      await runRebalance({
        tickRange: config.tickRange,
        slippageToleranceBps: config.slippageBps,
      });
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

startApiServer(port);
startMonitor({
  onSnapshot: (snapshot) => {
    void handleSnapshot(snapshot);
  },
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
