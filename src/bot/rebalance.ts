import { BigNumber, ContractReceipt, ethers } from 'ethers';
import { CurrencyAmount } from '@uniswap/sdk-core';
import { nearestUsableTick, Position } from '@uniswap/v3-sdk';

import { loadWriteSettings, WriteSettings } from '../config/settings';
import { createHybridProvider } from '../utils/provider';
import { ensureAllowance, getErc20 } from '../uniswap/erc20';
import { loadPoolContext } from '../uniswap/pool';
import { getPositionManager, buildMintCall, collectAll, decreaseLiquidity, parseEventAmounts } from '../uniswap/positions';
import { getSwapRouter, swapExactInputSingle, swapExactOutputSingle } from '../uniswap/swap';
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

function calcNetValueIn1(params: {
  amount0: BigNumber;
  amount1: BigNumber;
  token0Decimals: number;
  token1Decimals: number;
  price0In1: number;
}): number {
  const val0 = parseFloat(ethers.utils.formatUnits(params.amount0, params.token0Decimals));
  const val1 = parseFloat(ethers.utils.formatUnits(params.amount1, params.token1Decimals));
  return val0 * params.price0In1 + val1;
}

function calcPositionNetValueIn1(params: {
  pool: Position['pool'];
  liquidity: BigNumber;
  tickLower: number;
  tickUpper: number;
}): number {
  const position = new Position({
    pool: params.pool,
    liquidity: params.liquidity.toString(),
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
  });
  const amount0 = parseFloat(position.amount0.toSignificant(10));
  const amount1 = parseFloat(position.amount1.toSignificant(10));
  const price0In1 = parseFloat(params.pool.token0Price.toSignificant(10));
  return amount0 * price0In1 + amount1;
}

export type CloseResult = {
  closeTxHash: string | null;
  collected0: string;
  collected1: string;
  principal0: string;
  principal1: string;
  price0In1: number;
  closedNetValueIn1: number;
  closedFeesIn1: number;
};

export type RebalanceResult = {
  tokenId: string;
  poolAddress: string;
  token0Address: string;
  token0Symbol: string;
  token0Decimals: number;
  token1Address: string;
  token1Symbol: string;
  token1Decimals: number;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  price0In1: number;
  netValueIn1: number;
  fees0: string;
  fees1: string;
  gasCostNative: string;
  gasCostIn1: number;
  mintTxHash: string;
  reason: string;
  closeTxHash: string;
  closedNetValueIn1: number;
  closedFeesIn1: number;
};

export async function closePosition(overrides: Partial<WriteSettings> = {}): Promise<CloseResult> {
  const settings = { ...loadWriteSettings(), ...overrides };
  const providers = createHybridProvider(settings.rpcUrl, settings.rpcWss);
  const signer = new ethers.Wallet(settings.privateKey, providers.http);
  const owner = await signer.getAddress();

  const nfpm = getPositionManager(signer);
  const poolContext = await loadPoolContext(providers.http, settings.poolAddress, settings.chainId);
  const positionData = await nfpm.positions(settings.tokenId);
  const liquidity: BigNumber = positionData.liquidity;
  const deadline = Math.floor(Date.now() / 1000) + settings.rebalanceDeadlineSec;
  const price0In1 = parseFloat(poolContext.pool.token0Price.toSignificant(8));

  let principal0 = BigNumber.from(0);
  let principal1 = BigNumber.from(0);
  let decreaseReceipt: ContractReceipt | null = null;

  console.log(`\n=== Close Position ===`);
  console.log(`Owner: ${owner}`);

  if (liquidity.gt(0)) {
    const removeLiquidity = liquidity.mul(settings.removePercent).div(100);
    console.log(`1) Decrease Liquidity: ${settings.removePercent}%`);
    decreaseReceipt = await decreaseLiquidity(nfpm, settings.tokenId, removeLiquidity, deadline);
    const principalAmounts = parseEventAmounts(decreaseReceipt);
    principal0 = principalAmounts.amount0;
    principal1 = principalAmounts.amount1;
  } else {
    console.log('1) Liquidity already zero. Skip decrease.');
  }

  console.log('2) Collect fees and principal');
  const collectReceipt = await collectAll(nfpm, settings.tokenId, owner);
  const collected = parseEventAmounts(collectReceipt);
  const fees0 = collected.amount0.gt(principal0) ? collected.amount0.sub(principal0) : BigNumber.from(0);
  const fees1 = collected.amount1.gt(principal1) ? collected.amount1.sub(principal1) : BigNumber.from(0);
  const closedNetValueIn1 = calcNetValueIn1({
    amount0: collected.amount0,
    amount1: collected.amount1,
    token0Decimals: poolContext.token0.decimals,
    token1Decimals: poolContext.token1.decimals,
    price0In1,
  });
  const closedFeesIn1 =
    parseFloat(ethers.utils.formatUnits(fees0, poolContext.token0.decimals)) * price0In1 +
    parseFloat(ethers.utils.formatUnits(fees1, poolContext.token1.decimals));
  console.log('=== Close Done ===');

  return {
    closeTxHash: collectReceipt.transactionHash ?? null,
    collected0: collected.amount0.toString(),
    collected1: collected.amount1.toString(),
    principal0: principal0.toString(),
    principal1: principal1.toString(),
    price0In1,
    closedNetValueIn1,
    closedFeesIn1,
  };
}

export async function runRebalance(
  overrides: Partial<WriteSettings> = {},
  reason = 'auto'
): Promise<RebalanceResult> {
  const settings = { ...loadWriteSettings(), ...overrides };
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

  let decreaseReceipt: ContractReceipt | null = null;
  if (liquidity.gt(0)) {
    const removeLiquidity = liquidity.mul(settings.removePercent).div(100);
    console.log(`1) Decrease Liquidity: ${settings.removePercent}%`);
    decreaseReceipt = await decreaseLiquidity(nfpm, settings.tokenId, removeLiquidity, deadline);
    const amounts = parseEventAmounts(decreaseReceipt);
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

  let swapReceipt: ContractReceipt | null = null;
  if (balance0 < targetAmount0) {
    const deficit0 = targetAmount0 - balance0;
    const amountOut = toBigNumber(deficit0, poolContext.token0.decimals);
    const quotedIn: BigNumber = await swapRouter.callStatic.exactOutputSingle({
      tokenIn: poolContext.token1.address,
      tokenOut: poolContext.token0.address,
      fee: poolContext.fee,
      recipient: owner,
      deadline,
      amountOut,
      amountInMaximum: ethers.constants.MaxUint256,
      sqrtPriceLimitX96: 0,
    });
    const amountInMaximum = quotedIn.mul(10_000 + settings.slippageToleranceBps).div(10_000);

    console.log(
      `   - Swap for ${deficit0.toFixed(6)} ${poolContext.token0.symbol} using ${poolContext.token1.symbol}`
    );
    await ensureAllowance(token1Contract, owner, swapRouter.address, amountInMaximum);
    swapReceipt = await swapExactOutputSingle({
      router: swapRouter,
      tokenIn: poolContext.token1.address,
      tokenOut: poolContext.token0.address,
      fee: poolContext.fee,
      recipient: owner,
      amountOut,
      amountInMaximum,
      deadline,
    });
  } else if (balance0 > targetAmount0) {
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
    swapReceipt = await swapExactInputSingle({
      router: swapRouter,
      tokenIn: poolContext.token0.address,
      tokenOut: poolContext.token1.address,
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
  const mintTotalIn1 = settings.targetTotalToken1 > 0 ? settings.targetTotalToken1 : refreshedTotalValueIn1;
  const mintValueIn1 = mintTotalIn1 / 2;
  const mintTarget0 = mintValueIn1 / refreshedPrice0In1;
  const mintTarget1 = mintValueIn1;
  const mintAmount0Bn =
    settings.targetTotalToken1 > 0 ? toBigNumber(mintTarget0, refreshedPool.token0.decimals) : balance0Bn;
  const mintAmount1Bn =
    settings.targetTotalToken1 > 0 ? toBigNumber(mintTarget1, refreshedPool.token1.decimals) : balance1Bn;
  const cappedAmount0Bn = mintAmount0Bn.gt(balance0Bn) ? balance0Bn : mintAmount0Bn;
  const cappedAmount1Bn = mintAmount1Bn.gt(balance1Bn) ? balance1Bn : mintAmount1Bn;

  console.log(
    `   - Size ${ethers.utils.formatUnits(cappedAmount0Bn, refreshedPool.token0.decimals)} ${refreshedPool.token0.symbol} + ${ethers.utils.formatUnits(cappedAmount1Bn, refreshedPool.token1.decimals)} ${refreshedPool.token1.symbol}`
  );
  console.log(`   - Total ${mintTotalIn1.toFixed(6)} ${refreshedPool.token1.symbol}`);

  const amount0 = CurrencyAmount.fromRawAmount(refreshedPool.token0, cappedAmount0Bn.toString());
  const amount1 = CurrencyAmount.fromRawAmount(refreshedPool.token1, cappedAmount1Bn.toString());

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

  const mintTxHash = receipt.transactionHash;
  const mintedTokenId = minted.tokenId ?? settings.tokenId;
  const updatedPosition = await nfpm.positions(mintedTokenId);
  const positionNetValueIn1 = calcPositionNetValueIn1({
    pool: refreshedPool.pool,
    liquidity: updatedPosition.liquidity,
    tickLower: updatedPosition.tickLower,
    tickUpper: updatedPosition.tickUpper,
  });

  const principal0 = decreaseReceipt ? parseEventAmounts(decreaseReceipt).amount0 : BigNumber.from(0);
  const principal1 = decreaseReceipt ? parseEventAmounts(decreaseReceipt).amount1 : BigNumber.from(0);
  const fees0 = collected.amount0.gt(principal0) ? collected.amount0.sub(principal0) : BigNumber.from(0);
  const fees1 = collected.amount1.gt(principal1) ? collected.amount1.sub(principal1) : BigNumber.from(0);
  const closedNetValueIn1 = calcNetValueIn1({
    amount0: collected.amount0,
    amount1: collected.amount1,
    token0Decimals: poolContext.token0.decimals,
    token1Decimals: poolContext.token1.decimals,
    price0In1,
  });
  const closedFeesIn1 =
    parseFloat(ethers.utils.formatUnits(fees0, poolContext.token0.decimals)) * price0In1 +
    parseFloat(ethers.utils.formatUnits(fees1, poolContext.token1.decimals));

  const gasCosts: BigNumber[] = [];
  if (decreaseReceipt) gasCosts.push(decreaseReceipt.gasUsed.mul(decreaseReceipt.effectiveGasPrice));
  gasCosts.push(collectReceipt.gasUsed.mul(collectReceipt.effectiveGasPrice));
  if (swapReceipt) gasCosts.push(swapReceipt.gasUsed.mul(swapReceipt.effectiveGasPrice));
  gasCosts.push(receipt.gasUsed.mul(receipt.effectiveGasPrice));

  const totalGas = gasCosts.reduce((acc, value) => acc.add(value), BigNumber.from(0));
  const gasCostNative = ethers.utils.formatEther(totalGas);
  const gasCostIn1 = parseFloat(gasCostNative) * refreshedPrice0In1;

  console.log('\n=== Rebalance Done ===');

  return {
    tokenId: mintedTokenId.toString(),
    poolAddress: settings.poolAddress,
    token0Address: refreshedPool.token0.address,
    token0Symbol: poolContext.token0.symbol ?? 'TOKEN0',
    token0Decimals: refreshedPool.token0.decimals,
    token1Address: refreshedPool.token1.address,
    token1Symbol: poolContext.token1.symbol ?? 'TOKEN1',
    token1Decimals: refreshedPool.token1.decimals,
    fee: refreshedPool.fee,
    tickLower: lowerTick,
    tickUpper: upperTick,
    liquidity: updatedPosition.liquidity.toString(),
    amount0: minted.amount0.toString(),
    amount1: minted.amount1.toString(),
    price0In1: refreshedPrice0In1,
    netValueIn1: positionNetValueIn1,
    fees0: fees0.toString(),
    fees1: fees1.toString(),
    gasCostNative,
    gasCostIn1,
    mintTxHash,
    reason,
    closeTxHash: collectReceipt.transactionHash,
    closedNetValueIn1,
    closedFeesIn1,
  };
}

export async function mintNewPosition(
  overrides: Partial<WriteSettings> = {},
  reason = 'manual_create'
): Promise<RebalanceResult> {
  const settings = { ...loadWriteSettings(), ...overrides };
  const providers = createHybridProvider(settings.rpcUrl, settings.rpcWss);
  const signer = new ethers.Wallet(settings.privateKey, providers.http);
  const owner = await signer.getAddress();

  const nfpm = getPositionManager(signer);
  const swapRouter = getSwapRouter(signer);
  const poolContext = await loadPoolContext(providers.http, settings.poolAddress, settings.chainId);

  console.log(`\n=== Mint New Position ===`);
  console.log(`Owner: ${owner}`);
  console.log(`Pool : ${poolContext.token0.symbol}/${poolContext.token1.symbol}`);

  const deadline = Math.floor(Date.now() / 1000) + settings.rebalanceDeadlineSec;

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

  console.log('\n1) Balance adjust to 50:50 value');
  console.log(`   - Price 1 ${poolContext.token0.symbol} = ${price0In1.toFixed(6)} ${poolContext.token1.symbol}`);
  console.log(`   - Target ${targetAmount0.toFixed(6)} ${poolContext.token0.symbol} + ${targetAmount1.toFixed(6)} ${poolContext.token1.symbol}`);
  console.log(`   - Target Total ${targetTotalIn1.toFixed(6)} ${poolContext.token1.symbol}`);

  if (settings.targetTotalToken1 > 0 && totalValueIn1 < settings.targetTotalToken1) {
    throw new Error('Total value is below TARGET_TOTAL_TOKEN1. Please fund the wallet.');
  }

  let swapReceipt: ContractReceipt | null = null;
  if (balance0 < targetAmount0) {
    const deficit0 = targetAmount0 - balance0;
    const amountOut = toBigNumber(deficit0, poolContext.token0.decimals);
    const quotedIn: BigNumber = await swapRouter.callStatic.exactOutputSingle({
      tokenIn: poolContext.token1.address,
      tokenOut: poolContext.token0.address,
      fee: poolContext.fee,
      recipient: owner,
      deadline,
      amountOut,
      amountInMaximum: ethers.constants.MaxUint256,
      sqrtPriceLimitX96: 0,
    });
    const amountInMaximum = quotedIn.mul(10_000 + settings.slippageToleranceBps).div(10_000);

    console.log(
      `   - Swap for ${deficit0.toFixed(6)} ${poolContext.token0.symbol} using ${poolContext.token1.symbol}`
    );
    await ensureAllowance(token1Contract, owner, swapRouter.address, amountInMaximum);
    swapReceipt = await swapExactOutputSingle({
      router: swapRouter,
      tokenIn: poolContext.token1.address,
      tokenOut: poolContext.token0.address,
      fee: poolContext.fee,
      recipient: owner,
      amountOut,
      amountInMaximum,
      deadline,
    });
  } else if (balance0 > targetAmount0) {
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
    swapReceipt = await swapExactInputSingle({
      router: swapRouter,
      tokenIn: poolContext.token0.address,
      tokenOut: poolContext.token1.address,
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

  console.log('\n2) Mint new position');
  console.log(`   - Tick range ${lowerTick} ~ ${upperTick}`);
  const refreshedPrice0In1 = parseFloat(refreshedPool.pool.token0Price.toSignificant(8));
  const refreshedTotalValueIn1 = balance0 * refreshedPrice0In1 + balance1;
  const mintTotalIn1 = settings.targetTotalToken1 > 0 ? settings.targetTotalToken1 : refreshedTotalValueIn1;
  const mintValueIn1 = mintTotalIn1 / 2;
  const mintTarget0 = mintValueIn1 / refreshedPrice0In1;
  const mintTarget1 = mintValueIn1;
  const mintAmount0Bn =
    settings.targetTotalToken1 > 0 ? toBigNumber(mintTarget0, refreshedPool.token0.decimals) : balance0Bn;
  const mintAmount1Bn =
    settings.targetTotalToken1 > 0 ? toBigNumber(mintTarget1, refreshedPool.token1.decimals) : balance1Bn;
  const cappedAmount0Bn = mintAmount0Bn.gt(balance0Bn) ? balance0Bn : mintAmount0Bn;
  const cappedAmount1Bn = mintAmount1Bn.gt(balance1Bn) ? balance1Bn : mintAmount1Bn;

  console.log(
    `   - Size ${ethers.utils.formatUnits(cappedAmount0Bn, refreshedPool.token0.decimals)} ${refreshedPool.token0.symbol} + ${ethers.utils.formatUnits(cappedAmount1Bn, refreshedPool.token1.decimals)} ${refreshedPool.token1.symbol}`
  );
  console.log(`   - Total ${mintTotalIn1.toFixed(6)} ${refreshedPool.token1.symbol}`);

  const amount0 = CurrencyAmount.fromRawAmount(refreshedPool.token0, cappedAmount0Bn.toString());
  const amount1 = CurrencyAmount.fromRawAmount(refreshedPool.token1, cappedAmount1Bn.toString());

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

  const mintTxHash = receipt.transactionHash;
  const mintedTokenId = minted.tokenId ?? settings.tokenId;
  const updatedPosition = await nfpm.positions(mintedTokenId);
  const positionNetValueIn1 = calcPositionNetValueIn1({
    pool: refreshedPool.pool,
    liquidity: updatedPosition.liquidity,
    tickLower: updatedPosition.tickLower,
    tickUpper: updatedPosition.tickUpper,
  });

  const gasCosts: BigNumber[] = [];
  if (swapReceipt) gasCosts.push(swapReceipt.gasUsed.mul(swapReceipt.effectiveGasPrice));
  gasCosts.push(receipt.gasUsed.mul(receipt.effectiveGasPrice));

  const totalGas = gasCosts.reduce((acc, value) => acc.add(value), BigNumber.from(0));
  const gasCostNative = ethers.utils.formatEther(totalGas);
  const gasCostIn1 = parseFloat(gasCostNative) * refreshedPrice0In1;

  console.log('\n=== Mint Done ===');

  return {
    tokenId: mintedTokenId.toString(),
    poolAddress: settings.poolAddress,
    token0Address: refreshedPool.token0.address,
    token0Symbol: poolContext.token0.symbol ?? 'TOKEN0',
    token0Decimals: refreshedPool.token0.decimals,
    token1Address: refreshedPool.token1.address,
    token1Symbol: poolContext.token1.symbol ?? 'TOKEN1',
    token1Decimals: refreshedPool.token1.decimals,
    fee: refreshedPool.fee,
    tickLower: lowerTick,
    tickUpper: upperTick,
    liquidity: updatedPosition.liquidity.toString(),
    amount0: minted.amount0.toString(),
    amount1: minted.amount1.toString(),
    price0In1: refreshedPrice0In1,
    netValueIn1: positionNetValueIn1,
    fees0: '0',
    fees1: '0',
    gasCostNative,
    gasCostIn1,
    mintTxHash,
    reason,
    closeTxHash: '',
    closedNetValueIn1: 0,
    closedFeesIn1: 0,
  };
}

async function main(): Promise<void> {
  await runRebalance();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
