import { BigNumber, ethers } from 'ethers';
import { CurrencyAmount } from '@uniswap/sdk-core';
import { nearestUsableTick, Position } from '@uniswap/v3-sdk';

import { loadWriteSettings } from '../config/settings';
import { createHybridProvider } from '../utils/provider';
import { ensureAllowance, getErc20 } from '../uniswap/erc20';
import { loadPoolContext } from '../uniswap/pool';
import { getPositionManager, buildMintCall, collectAll, decreaseLiquidity, parseEventAmounts } from '../uniswap/positions';
import { getSwapRouter, swapExactInputSingle } from '../uniswap/swap';
import { NFPM_ADDRESS } from '../uniswap/addresses';

function toFixedAmount(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function toBigNumber(value: number, decimals: number): BigNumber {
  return ethers.utils.parseUnits(toFixedAmount(value, decimals), decimals);
}

function applySlippage(value: number, slippageBps: number): number {
  const ratio = 1 - slippageBps / 10_000;
  return value * ratio;
}

async function main(): Promise<void> {
  const settings = loadWriteSettings();
  const providers = createHybridProvider(settings.rpcUrl, settings.rpcWss);
  const signer = new ethers.Wallet(settings.privateKey, providers.http);
  const owner = await signer.getAddress();

  const nfpm = getPositionManager(signer);
  const swapRouter = getSwapRouter(signer);

  const poolContext = await loadPoolContext(providers.http, settings.poolAddress, settings.chainId);

  console.log(`\n=== Rebalance Start ===`);
  console.log(`Owner: ${owner}`);
  console.log(`Pool : ${poolContext.token0.symbol}/${poolContext.token1.symbol}`);

  const positionData = await nfpm.positions(settings.tokenId);
  const liquidity: BigNumber = positionData.liquidity;

  const deadline = Math.floor(Date.now() / 1000) + settings.rebalanceDeadlineSec;

  if (liquidity.gt(0)) {
    const removeLiquidity = liquidity.mul(settings.removePercent).div(100);
    console.log(`1) Decrease Liquidity: ${settings.removePercent}%`);
    const receipt = await decreaseLiquidity(nfpm, settings.tokenId, removeLiquidity, deadline);
    const amounts = parseEventAmounts(receipt);
    console.log(`   - Decreased amount0=${ethers.utils.formatUnits(amounts.amount0, poolContext.token0.decimals)}`);
    console.log(`   - Decreased amount1=${ethers.utils.formatUnits(amounts.amount1, poolContext.token1.decimals)}`);
  } else {
    console.log('1) Liquidity already zero. Skip decrease.');
  }

  console.log('2) Collect fees and principal');
  const collectReceipt = await collectAll(nfpm, settings.tokenId, owner);
  const collected = parseEventAmounts(collectReceipt);
  console.log(`   - Collected amount0=${ethers.utils.formatUnits(collected.amount0, poolContext.token0.decimals)}`);
  console.log(`   - Collected amount1=${ethers.utils.formatUnits(collected.amount1, poolContext.token1.decimals)}`);

  const token0Contract = getErc20(poolContext.token0.address, signer);
  const token1Contract = getErc20(poolContext.token1.address, signer);

  let balance0Bn: BigNumber = await token0Contract.balanceOf(owner);
  let balance1Bn: BigNumber = await token1Contract.balanceOf(owner);

  let balance0 = parseFloat(ethers.utils.formatUnits(balance0Bn, poolContext.token0.decimals));
  let balance1 = parseFloat(ethers.utils.formatUnits(balance1Bn, poolContext.token1.decimals));

  const price0In1 = parseFloat(poolContext.pool.token0Price.toSignificant(8));
  const totalValueIn1 = balance0 * price0In1 + balance1;
  const targetTotalIn1 = settings.targetTotalToken1 > 0 ? settings.targetTotalToken1 : totalValueIn1;
  const targetValueIn1 = targetTotalIn1 / 2;
  const targetAmount0 = targetValueIn1 / price0In1;
  const targetAmount1 = targetValueIn1;

  console.log('\n3) Rebalance to 50:50 value');
  console.log(`   - Price 1 ${poolContext.token0.symbol} = ${price0In1.toFixed(6)} ${poolContext.token1.symbol}`);
  console.log(`   - Target ${targetAmount0.toFixed(6)} ${poolContext.token0.symbol} + ${targetAmount1.toFixed(6)} ${poolContext.token1.symbol}`);
  console.log(`   - Target Total ${targetTotalIn1.toFixed(6)} ${poolContext.token1.symbol}`);

  if (settings.targetTotalToken1 > 0 && totalValueIn1 < settings.targetTotalToken1) {
    throw new Error('Total value is below TARGET_TOTAL_TOKEN1. Please fund the wallet.');
  }

  if (balance0 > targetAmount0) {
    const excess0 = balance0 - targetAmount0;
    const amountIn = toBigNumber(excess0, poolContext.token0.decimals);
    const quotedOut: BigNumber = await swapRouter.callStatic.exactInputSingle({
      tokenIn: poolContext.token0.address,
      tokenOut: poolContext.token1.address,
      fee: poolContext.fee,
      recipient: owner,
      deadline,
      amountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    });
    const amountOutMin = quotedOut.mul(10_000 - settings.slippageToleranceBps).div(10_000);

    console.log(`   - Swap ${excess0.toFixed(6)} ${poolContext.token0.symbol} -> ${poolContext.token1.symbol}`);
    await ensureAllowance(token0Contract, owner, swapRouter.address, amountIn);
    await swapExactInputSingle({
      router: swapRouter,
      tokenIn: poolContext.token0.address,
      tokenOut: poolContext.token1.address,
      fee: poolContext.fee,
      recipient: owner,
      amountIn,
      amountOutMinimum: amountOutMin,
      deadline,
    });
  } else if (balance1 > targetAmount1) {
    const excess1 = balance1 - targetAmount1;
    const amountIn = toBigNumber(excess1, poolContext.token1.decimals);
    const quotedOut: BigNumber = await swapRouter.callStatic.exactInputSingle({
      tokenIn: poolContext.token1.address,
      tokenOut: poolContext.token0.address,
      fee: poolContext.fee,
      recipient: owner,
      deadline,
      amountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    });
    const amountOutMin = quotedOut.mul(10_000 - settings.slippageToleranceBps).div(10_000);

    console.log(`   - Swap ${excess1.toFixed(6)} ${poolContext.token1.symbol} -> ${poolContext.token0.symbol}`);
    await ensureAllowance(token1Contract, owner, swapRouter.address, amountIn);
    await swapExactInputSingle({
      router: swapRouter,
      tokenIn: poolContext.token1.address,
      tokenOut: poolContext.token0.address,
      fee: poolContext.fee,
      recipient: owner,
      amountIn,
      amountOutMinimum: amountOutMin,
      deadline,
    });
  } else {
    console.log('   - No swap needed.');
  }

  balance0Bn = await token0Contract.balanceOf(owner);
  balance1Bn = await token1Contract.balanceOf(owner);

  balance0 = parseFloat(ethers.utils.formatUnits(balance0Bn, poolContext.token0.decimals));
  balance1 = parseFloat(ethers.utils.formatUnits(balance1Bn, poolContext.token1.decimals));

  const refreshedPool = await loadPoolContext(providers.http, settings.poolAddress, settings.chainId);
  const lowerTick = nearestUsableTick(refreshedPool.slot0.tick - settings.tickRange, refreshedPool.tickSpacing);
  const upperTick = nearestUsableTick(refreshedPool.slot0.tick + settings.tickRange, refreshedPool.tickSpacing);

  console.log('\n4) Mint new position');
  console.log(`   - Tick range ${lowerTick} ~ ${upperTick}`);
  const refreshedPrice0In1 = parseFloat(refreshedPool.pool.token0Price.toSignificant(8));
  const refreshedTotalValueIn1 = balance0 * refreshedPrice0In1 + balance1;
  console.log(
    `   - Size ${balance0.toFixed(6)} ${refreshedPool.token0.symbol} + ${balance1.toFixed(6)} ${refreshedPool.token1.symbol}`
  );
  console.log(`   - Total ${refreshedTotalValueIn1.toFixed(6)} ${refreshedPool.token1.symbol}`);

  const amount0 = CurrencyAmount.fromRawAmount(refreshedPool.token0, balance0Bn.toString());
  const amount1 = CurrencyAmount.fromRawAmount(refreshedPool.token1, balance1Bn.toString());

  const position = Position.fromAmounts({
    pool: refreshedPool.pool,
    tickLower: lowerTick,
    tickUpper: upperTick,
    amount0: amount0.quotient,
    amount1: amount1.quotient,
    useFullPrecision: true,
  });

  const mintAmounts = {
    amount0: BigNumber.from(position.mintAmounts.amount0.toString()),
    amount1: BigNumber.from(position.mintAmounts.amount1.toString()),
  };

  if (mintAmounts.amount0.isZero() || mintAmounts.amount1.isZero()) {
    throw new Error('Mint amounts are zero. Check balances and tick range.');
  }

  await ensureAllowance(token0Contract, owner, NFPM_ADDRESS, mintAmounts.amount0);
  await ensureAllowance(token1Contract, owner, NFPM_ADDRESS, mintAmounts.amount1);

  const mintCall = buildMintCall(position, owner, settings.slippageToleranceBps, deadline);
  const tx = await signer.sendTransaction({
    to: NFPM_ADDRESS,
    data: mintCall.calldata,
    value: mintCall.value,
  });
  const receipt = await tx.wait();

  const minted = parseEventAmounts(receipt);
  if (minted.tokenId) {
    console.log(`   - New TokenID: ${minted.tokenId}`);
  }
  console.log(`   - Mint tx: ${receipt.transactionHash}`);

  console.log('\n=== Rebalance Done ===');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
