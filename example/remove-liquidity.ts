import { ethers } from 'ethers';
import { Pool } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
import NFPM_ABI from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';

const RPC_URL = process.env.RPC_URL ?? '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';
const TOKEN_ID = process.env.TOKEN_ID;
const REMOVE_PERCENT = Number(process.env.REMOVE_PERCENT ?? '100'); 
const NFPM_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const POOL_ADDRESS = '0xC6962004f452bE9203591991D15f6b388e09E8D0'; 
const CHAIN_ID = 42161;

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const MAX_UINT128 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffff');

async function main() {
  if (!RPC_URL || !PRIVATE_KEY) throw new Error('RPC_URL, PRIVATE_KEY missing');
  if (!TOKEN_ID) throw new Error('TOKEN_ID missing');

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const sender = await signer.getAddress();
  const nfpm = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, signer);
  const nfpmInterface = new ethers.utils.Interface(NFPM_ABI.abi);

  // --- 1. 情報取得 ---
  const positionData = await nfpm.positions(TOKEN_ID);
  const liquidity = positionData.liquidity;

  if (liquidity.eq(0)) {
    console.log(`Token ID ${TOKEN_ID} の流動性は既に0です。`);
    return;
  }

  const token0Contract = new ethers.Contract(positionData.token0, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(positionData.token1, ERC20_ABI, provider);
  const [symbol0, decimal0, symbol1, decimal1] = await Promise.all([
    token0Contract.symbol(),
    token0Contract.decimals(),
    token1Contract.symbol(),
    token1Contract.decimals(),
  ]);

  const poolContract = new ethers.Contract(POOL_ADDRESS, IUniswapV3PoolABI.abi, provider);
  const [slot0, poolLiquidity] = await Promise.all([
    poolContract.slot0(),
    poolContract.liquidity()
  ]);

  const WETH = new Token(CHAIN_ID, positionData.token0, decimal0, symbol0);
  const USDC = new Token(CHAIN_ID, positionData.token1, decimal1, symbol1);
  const pool = new Pool(WETH, USDC, 500, slot0.sqrtPriceX96.toString(), poolLiquidity.toString(), slot0.tick);
  
  const ethPriceUSDC = parseFloat(pool.token0Price.toSignificant(6));
  console.log(`\n=== ポジション解除レポート (TokenID: ${TOKEN_ID}) ===`);
  console.log(`Rate: 1 WETH = ${ethPriceUSDC.toFixed(2)} USDC`);

  // --- 2. トランザクション実行 ---
  const removeLiquidity = liquidity.mul(REMOVE_PERCENT).div(100);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  let baseNonce = await provider.getTransactionCount(sender, 'pending');
  let totalGasCostETH = ethers.BigNumber.from(0);

  // A) decreaseLiquidity (ここで「元本」が確定する)
  console.log(`\n1. 流動性を削減中...`);
  const decreaseTx = await nfpm.decreaseLiquidity(
    {
      tokenId: TOKEN_ID,
      liquidity: removeLiquidity,
      amount0Min: 0,
      amount1Min: 0,
      deadline,
    },
    { nonce: baseNonce }
  );
  const decreaseReceipt = await decreaseTx.wait();
  totalGasCostETH = totalGasCostETH.add(decreaseReceipt.gasUsed.mul(decreaseReceipt.effectiveGasPrice));
  console.log(`   Tx: ${decreaseTx.hash}`);

  // ★追加: DecreaseLiquidityイベントから「元本」を取得
  let principal0 = ethers.BigNumber.from(0);
  let principal1 = ethers.BigNumber.from(0);
  for (const log of decreaseReceipt.logs) {
    try {
      const parsed = nfpmInterface.parseLog(log);
      if (parsed.name === 'DecreaseLiquidity') {
        principal0 = principal0.add(parsed.args.amount0);
        principal1 = principal1.add(parsed.args.amount1);
      }
    } catch (e) {}
  }

  // B) collect (ここで「元本+手数料」が回収される)
  console.log(`\n2. 全額回収中...`);
  const collectTx = await nfpm.collect(
    {
      tokenId: TOKEN_ID,
      recipient: sender,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    },
    { nonce: baseNonce + 1 }
  );
  const collectReceipt = await collectTx.wait();
  totalGasCostETH = totalGasCostETH.add(collectReceipt.gasUsed.mul(collectReceipt.effectiveGasPrice));
  console.log(`   Tx: ${collectTx.hash}`);

  // ★Collectイベントから「合計回収額」を取得
  let collected0 = ethers.BigNumber.from(0);
  let collected1 = ethers.BigNumber.from(0);
  for (const log of collectReceipt.logs) {
    try {
      const parsed = nfpmInterface.parseLog(log);
      if (parsed.name === 'Collect') {
        collected0 = collected0.add(parsed.args.amount0);
        collected1 = collected1.add(parsed.args.amount1);
      }
    } catch (e) {}
  }

  // --- 3. 手数料の計算 (合計 - 元本 = 手数料) ---
  const fees0BN = collected0.sub(principal0);
  const fees1BN = collected1.sub(principal1);

  // 数値変換 (Float)
  const valCollected0 = parseFloat(ethers.utils.formatUnits(collected0, decimal0));
  const valCollected1 = parseFloat(ethers.utils.formatUnits(collected1, decimal1));
  const valFees0 = parseFloat(ethers.utils.formatUnits(fees0BN, decimal0));
  const valFees1 = parseFloat(ethers.utils.formatUnits(fees1BN, decimal1));
  
  // コスト計算
  const gasETH = parseFloat(ethers.utils.formatEther(totalGasCostETH));
  const gasUSDC = gasETH * ethPriceUSDC;
  
  // 利益計算 (手数料のUSDC換算合計)
  const totalFeesUSDC = (valFees0 * ethPriceUSDC) + valFees1;
  const netProfitUSDC = totalFeesUSDC - gasUSDC;

  // --- 最終レポート ---
  console.log(`\n====== 収支結果 ======`);
  console.log(`[1. 元本 (返却された資金)]`);
  console.log(`  ${symbol0}: ${ethers.utils.formatUnits(principal0, decimal0)}`);
  console.log(`  ${symbol1}: ${ethers.utils.formatUnits(principal1, decimal1)}`);

  console.log(`\n[2. 手数料 (稼いだ利益)]`);
  console.log(`  ${symbol0}: ${valFees0.toFixed(8)}`);
  console.log(`  ${symbol1}: ${valFees1.toFixed(8)}`);
  console.log(`  --------------`);
  console.log(`  手数料合計: ${totalFeesUSDC.toFixed(6)} USDC`);

  console.log(`\n[3. コスト (ガス代)]`);
  console.log(`  -${gasUSDC.toFixed(4)} USDC`);

  console.log(`\n[4. 純損益 (手数料 - コスト)]`);
  if (netProfitUSDC >= 0) {
    console.log(`  +${netProfitUSDC.toFixed(4)} USDC (黒字)`);
  } else {
    console.log(`  ${netProfitUSDC.toFixed(4)} USDC (赤字)`);
  }
  console.log(`======================\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});