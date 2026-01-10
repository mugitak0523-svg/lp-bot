import { ethers } from 'ethers';
import { Pool, Position } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
import NFPM_ABI from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import PoolABI from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import IERC20_METADATA_ABI from '@uniswap/v3-periphery/artifacts/contracts/interfaces/IERC20Metadata.sol/IERC20Metadata.json';

import { loadSettings } from '../config/settings';
import { createHttpProvider, createWsProvider } from '../utils/provider';
import { formatPercent, logHeader } from '../utils/logger';
import { MonitorSnapshot, addLog } from '../state/store';

const NFPM_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const MAX_UINT128 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffff');

type MonitorState = {
  initialNetValue: number | null;
  lastUpdateTime: number;
  isUpdating: boolean;
};

function formatSigned(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

export type MonitorCallbacks = {
  onSnapshot?: (snapshot: MonitorSnapshot) => void;
};

export type MonitorOptions = {
  tokenId?: string;
  initialNetValue?: number;
};

export type MonitorController = {
  tokenId: string;
  stop: () => void;
};

export async function startMonitor(
  callbacks: MonitorCallbacks = {},
  options: MonitorOptions = {}
): Promise<MonitorController> {
  const settings = loadSettings();
  const tokenId = options.tokenId ?? settings.tokenId;
  const httpProvider = createHttpProvider(settings.rpcUrl);

  const nfpm = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, httpProvider);
  const poolContract = new ethers.Contract(settings.poolAddress, PoolABI.abi, httpProvider);

  const tokenIdBN = ethers.BigNumber.from(tokenId);
  const ownerAddress = await nfpm.ownerOf(tokenIdBN);

  const [token0Addr, token1Addr, fee] = await Promise.all([
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
  ]);

  const token0Contract = new ethers.Contract(token0Addr, IERC20_METADATA_ABI.abi, httpProvider);
  const token1Contract = new ethers.Contract(token1Addr, IERC20_METADATA_ABI.abi, httpProvider);

  const [dec0, dec1, sym0, sym1] = await Promise.all([
    token0Contract.decimals(),
    token1Contract.decimals(),
    token0Contract.symbol(),
    token1Contract.symbol(),
  ]);

  const token0 = new Token(settings.chainId, token0Addr, dec0, sym0);
  const token1 = new Token(settings.chainId, token1Addr, dec1, sym1);

  logHeader('Uniswap V3 LP Monitor');
  console.log(`Target: TokenID ${tokenId} (${sym0}/${sym1})`);
  console.log(`Owner : ${ownerAddress}`);

  const state: MonitorState = {
    initialNetValue: typeof options.initialNetValue === 'number' ? options.initialNetValue : null,
    lastUpdateTime: 0,
    isUpdating: false,
  };

  const reportState = async (trigger: string): Promise<void> => {
    if (state.isUpdating) return;
    state.isUpdating = true;

    try {
      const [posData, slot0, liquidity] = await Promise.all([
        nfpm.positions(tokenIdBN),
        poolContract.slot0(),
        poolContract.liquidity(),
      ]);

      const pool = new Pool(
        token0,
        token1,
        fee,
        slot0.sqrtPriceX96.toString(),
        liquidity.toString(),
        slot0.tick
      );

      const position = new Position({
        pool,
        liquidity: posData.liquidity.toString(),
        tickLower: posData.tickLower,
        tickUpper: posData.tickUpper,
      });

      const amount0 = parseFloat(position.amount0.toSignificant(6));
      const amount1 = parseFloat(position.amount1.toSignificant(6));
      const price0In1 = parseFloat(pool.token0Price.toSignificant(8));

      const value0In1 = amount0 * price0In1;
      const netValueIn1 = value0In1 + amount1;

      if (state.initialNetValue === null && posData.liquidity.gt(0)) {
        state.initialNetValue = netValueIn1;
      }

      const pnl = posData.liquidity.gt(0) ? netValueIn1 - (state.initialNetValue ?? 0) : 0;
      const pnlPct = posData.liquidity.gt(0) && state.initialNetValue ? (pnl / state.initialNetValue) * 100 : 0;

      let feesText = '(fetching)';
      let fee0 = 0;
      let fee1 = 0;
      let feeTotalIn1 = 0;
      let feeYield = 0;
      try {
        const feeResult = await nfpm.callStatic.collect(
          {
            tokenId: tokenIdBN,
            recipient: ownerAddress,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128,
          },
          { from: ownerAddress }
        );

        fee0 = parseFloat(ethers.utils.formatUnits(feeResult.amount0, dec0));
        fee1 = parseFloat(ethers.utils.formatUnits(feeResult.amount1, dec1));
        feeTotalIn1 = fee0 * price0In1 + fee1;
        feeYield = netValueIn1 > 0 ? (feeTotalIn1 / netValueIn1) * 100 : 0;

        feesText = `+${fee0.toFixed(6)} ${sym0} / +${fee1.toFixed(6)} ${sym1} (Total: ${feeTotalIn1.toFixed(4)} ${sym1}, Yield: ${formatPercent(feeYield)})`;
      } catch (error) {
        feesText = '(calc failed)';
      }

      const currentTick = slot0.tick;
      const tickLower = posData.tickLower;
      const tickUpper = posData.tickUpper;

      let statusHeader = 'IN RANGE';
      if (currentTick < tickLower) statusHeader = `OUT OF RANGE (LOW, ${sym0} 100%)`;
      else if (currentTick > tickUpper) statusHeader = `OUT OF RANGE (HIGH, ${sym1} 100%)`;

      const logTime = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
      const snapshotTime = new Date().toISOString();
      const ratio0 = netValueIn1 > 0 ? (value0In1 / netValueIn1) * 100 : 0;
      const ratio1 = netValueIn1 > 0 ? (amount1 / netValueIn1) * 100 : 0;

      console.log(`\n[${logTime}] ${trigger} | ${statusHeader}`);
      console.log(`Price : 1 ${sym0} = ${price0In1.toFixed(6)} ${sym1}`);
      console.log(`Range : tick ${tickLower} ~ ${tickUpper} (current ${currentTick})`);
      console.log(`Asset : ${sym0} ${ratio0.toFixed(0)}% / ${sym1} ${ratio1.toFixed(0)}%`);
      console.log(`Value : ${amount0.toFixed(4)} ${sym0} + ${amount1.toFixed(4)} ${sym1}`);
      console.log(`Net   : ${netValueIn1.toFixed(4)} ${sym1} (PnL ${formatSigned(pnl)} ${sym1}, ${formatSigned(pnlPct, 2)}%)`);
      console.log(`Fees  : ${feesText}`);

      addLog(
        [
          `[${logTime}] ${trigger} | ${statusHeader}`,
          `Price : 1 ${sym0} = ${price0In1.toFixed(6)} ${sym1}`,
          `Range : tick ${tickLower} ~ ${tickUpper} (current ${currentTick})`,
          `Asset : ${sym0} ${ratio0.toFixed(0)}% / ${sym1} ${ratio1.toFixed(0)}%`,
          `Value : ${amount0.toFixed(4)} ${sym0} + ${amount1.toFixed(4)} ${sym1}`,
          `Net   : ${netValueIn1.toFixed(4)} ${sym1} (PnL ${formatSigned(pnl)} ${sym1}, ${formatSigned(pnlPct, 2)}%)`,
          `Fees  : ${feesText}`,
        ].join('\n'),
        snapshotTime,
        tokenId
      );

      callbacks.onSnapshot?.({
        timestamp: snapshotTime,
        trigger,
        status: statusHeader,
        symbol0: sym0,
        symbol1: sym1,
        price0In1,
        tickLower,
        tickUpper,
        currentTick,
        ratio0,
        ratio1,
        amount0,
        amount1,
        netValueIn1,
        pnl,
        pnlPct,
        fee0,
        fee1,
        feeTotalIn1,
        feeYieldPct: feeYield,
        liquidity: posData.liquidity.toString(),
      });
    } catch (error) {
      console.error('Update Error:', error);
    } finally {
      state.isUpdating = false;
      state.lastUpdateTime = Date.now();
    }
  };

  await reportState('Init');

  const topic = ethers.utils.hexZeroPad(tokenIdBN.toHexString(), 32);
  let wsProvider = createWsProvider(settings.rpcWss);
  let nfpmWs: ethers.Contract | null = null;
  let poolWs: ethers.Contract | null = null;
  let stopped = false;

  const cleanupWs = (): void => {
    if (poolWs) poolWs.removeAllListeners();
    if (nfpmWs) nfpmWs.removeAllListeners();
    poolWs = null;
    nfpmWs = null;
  };

  const handleWsDisconnect = (): void => {
    if (stopped) return;
    console.error('WS Closed. Reconnecting...');
    cleanupWs();
    wsProvider.destroy();
    setTimeout(() => {
      if (stopped) return;
      wsProvider = createWsProvider(settings.rpcWss);
      attachWsListeners(wsProvider);
    }, 1000);
  };

  const attachWsListeners = (provider: ethers.providers.WebSocketProvider): void => {
    nfpmWs = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, provider);
    poolWs = new ethers.Contract(settings.poolAddress, PoolABI.abi, provider);

    poolWs.on(poolWs.filters.Swap(), async () => {
      const now = Date.now();
      if (now - state.lastUpdateTime > settings.updateIntervalMs && !state.isUpdating) {
        await reportState('Swap');
      }
    });

    nfpmWs.on(nfpmWs.filters.IncreaseLiquidity(topic), () => reportState('Liq+'));
    nfpmWs.on(nfpmWs.filters.DecreaseLiquidity(topic), () => reportState('Liq-'));
    nfpmWs.on(nfpmWs.filters.Collect(topic), () => reportState('Collect'));

    const socket = (provider as { _websocket?: { on?: (event: string, handler: () => void) => void } })._websocket;
    socket?.on?.('close', handleWsDisconnect);
    socket?.on?.('error', handleWsDisconnect);
  };

  attachWsListeners(wsProvider);

  return {
    tokenId,
    stop: () => {
      stopped = true;
      cleanupWs();
      wsProvider.destroy();
    },
  };
}

if (require.main === module) {
  startMonitor()
    .then(() => undefined)
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
