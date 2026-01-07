import { ethers } from 'ethers';
import { Pool, Position } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
import NFPM_ABI from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import PoolABI from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import IERC20_METADATA_ABI from '@uniswap/v3-periphery/artifacts/contracts/interfaces/IERC20Metadata.sol/IERC20Metadata.json';

import { loadSettings } from '../config/settings';
import { createHybridProvider } from '../utils/provider';
import { formatPercent, logHeader } from '../utils/logger';

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

async function main(): Promise<void> {
  const settings = loadSettings();
  const providers = createHybridProvider(settings.rpcUrl, settings.rpcWss);

  const nfpm = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, providers.http);
  const poolContract = new ethers.Contract(settings.poolAddress, PoolABI.abi, providers.http);

  const nfpmWs = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, providers.ws);
  const poolWs = new ethers.Contract(settings.poolAddress, PoolABI.abi, providers.ws);

  const tokenIdBN = ethers.BigNumber.from(settings.tokenId);
  const ownerAddress = await nfpm.ownerOf(tokenIdBN);

  const [token0Addr, token1Addr, fee] = await Promise.all([
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
  ]);

  const token0Contract = new ethers.Contract(token0Addr, IERC20_METADATA_ABI.abi, providers.http);
  const token1Contract = new ethers.Contract(token1Addr, IERC20_METADATA_ABI.abi, providers.http);

  const [dec0, dec1, sym0, sym1] = await Promise.all([
    token0Contract.decimals(),
    token1Contract.decimals(),
    token0Contract.symbol(),
    token1Contract.symbol(),
  ]);

  const token0 = new Token(settings.chainId, token0Addr, dec0, sym0);
  const token1 = new Token(settings.chainId, token1Addr, dec1, sym1);

  logHeader('Uniswap V3 LP Monitor');
  console.log(`Target: TokenID ${settings.tokenId} (${sym0}/${sym1})`);
  console.log(`Owner : ${ownerAddress}`);

  const state: MonitorState = {
    initialNetValue: null,
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

      if (state.initialNetValue === null) {
        state.initialNetValue = netValueIn1;
      }

      const pnl = netValueIn1 - (state.initialNetValue ?? 0);
      const pnlPct = state.initialNetValue ? (pnl / state.initialNetValue) * 100 : 0;

      let feesText = '(fetching)';
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

        const f0 = parseFloat(ethers.utils.formatUnits(feeResult.amount0, dec0));
        const f1 = parseFloat(ethers.utils.formatUnits(feeResult.amount1, dec1));
        const feeTotalIn1 = f0 * price0In1 + f1;
        const feeYield = netValueIn1 > 0 ? (feeTotalIn1 / netValueIn1) * 100 : 0;

        feesText = `+${f0.toFixed(6)} ${sym0} / +${f1.toFixed(6)} ${sym1} (Total: ${feeTotalIn1.toFixed(4)} ${sym1}, Yield: ${formatPercent(feeYield)})`;
      } catch (error) {
        feesText = '(calc failed)';
      }

      const currentTick = slot0.tick;
      const tickLower = posData.tickLower;
      const tickUpper = posData.tickUpper;

      let statusHeader = 'IN RANGE';
      if (currentTick < tickLower) statusHeader = `OUT OF RANGE (LOW, ${sym0} 100%)`;
      else if (currentTick > tickUpper) statusHeader = `OUT OF RANGE (HIGH, ${sym1} 100%)`;

      const timestamp = new Date().toLocaleTimeString();
      const ratio0 = netValueIn1 > 0 ? (value0In1 / netValueIn1) * 100 : 0;
      const ratio1 = netValueIn1 > 0 ? (amount1 / netValueIn1) * 100 : 0;

      console.log(`\n[${timestamp}] ${trigger} | ${statusHeader}`);
      console.log(`Price : 1 ${sym0} = ${price0In1.toFixed(6)} ${sym1}`);
      console.log(`Range : tick ${tickLower} ~ ${tickUpper} (current ${currentTick})`);
      console.log(`Asset : ${sym0} ${ratio0.toFixed(0)}% / ${sym1} ${ratio1.toFixed(0)}%`);
      console.log(`Value : ${amount0.toFixed(4)} ${sym0} + ${amount1.toFixed(4)} ${sym1}`);
      console.log(`Net   : ${netValueIn1.toFixed(4)} ${sym1} (PnL ${formatSigned(pnl)} ${sym1}, ${formatSigned(pnlPct, 2)}%)`);
      console.log(`Fees  : ${feesText}`);
    } catch (error) {
      console.error('Update Error:', error);
    } finally {
      state.isUpdating = false;
      state.lastUpdateTime = Date.now();
    }
  };

  await reportState('Init');

  poolWs.on(poolWs.filters.Swap(), async () => {
    const now = Date.now();
    if (now - state.lastUpdateTime > settings.updateIntervalMs && !state.isUpdating) {
      await reportState('Swap');
    }
  });

  const topic = ethers.utils.hexZeroPad(tokenIdBN.toHexString(), 32);
  nfpmWs.on(nfpmWs.filters.IncreaseLiquidity(topic), () => reportState('Liq+'));
  nfpmWs.on(nfpmWs.filters.DecreaseLiquidity(topic), () => reportState('Liq-'));
  nfpmWs.on(nfpmWs.filters.Collect(topic), () => reportState('Collect'));

  (providers.ws as { _websocket?: { on?: (event: string, handler: () => void) => void } })
    ._websocket?.on?.('close', () => {
    console.error('WS Closed. Exiting...');
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
