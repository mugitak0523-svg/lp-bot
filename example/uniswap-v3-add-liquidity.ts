import { ethers } from 'ethers';
import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core';
import { nearestUsableTick, NonfungiblePositionManager, Pool, Position } from '@uniswap/v3-sdk';
import NFPM_ABI from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import ERC20_ABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IERC20Minimal.sol/IERC20Minimal.json';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import SwapRouterABI from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json';

const RPC_URL = process.env.RPC_URL ?? '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

const CHAIN_ID = 42161; // Arbitrum One
const FEE = 500;
const POOL_ADDRESS = '0xC6962004f452bE9203591991D15f6b388e09E8D0';
const NFPM_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const MAX_UINT256 = ethers.constants.MaxUint256;

// ==========================================
// ★設定: ポジションの合計サイズ (USDC換算)
// ==========================================
const TOTAL_INVESTMENT_USDC = 200; // 例: 1.0なら合計1USDC分 (0.5 USDC + 0.5ドル分のETH)

const USDC = new Token(CHAIN_ID, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'USDC', 'USD Coin');
const WETH = new Token(CHAIN_ID, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 18, 'WETH', 'Wrapped Ether');

async function main() {
  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error('Set RPC_URL and PRIVATE_KEY in your environment.');
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const sender = await signer.getAddress();
  console.log(`Wallet: ${sender}`);
  console.log(`Target Investment: ${TOTAL_INVESTMENT_USDC} USDC Total`);

  // --- 残高チェック ---
  const usdcContract = new ethers.Contract(USDC.address, ERC20_ABI.abi, provider);
  const wethContract = new ethers.Contract(WETH.address, ERC20_ABI.abi, provider);

  const [usdcBal, wethBal] = await Promise.all([
    usdcContract.balanceOf(sender),
    wethContract.balanceOf(sender)
  ]);

  console.log(`\n--- Wallet Balances ---`);
  console.log(`USDC: ${ethers.utils.formatUnits(usdcBal, 6)}`);
  console.log(`WETH: ${ethers.utils.formatUnits(wethBal, 18)}`);

  // --- データ取得 ---
  const poolContract = new ethers.Contract(POOL_ADDRESS, IUniswapV3PoolABI.abi, provider);
  const [liquidity, slot0, tickSpacing] = await Promise.all([
    poolContract.liquidity(),
    poolContract.slot0(),
    poolContract.tickSpacing(),
  ]);

  const pool = new Pool(USDC, WETH, FEE, slot0.sqrtPriceX96.toString(), liquidity.toString(), slot0.tick);

  // --- 計算 ---
  const TICK_RANGE = 50;
  const lowerTick = nearestUsableTick(slot0.tick - TICK_RANGE, Number(tickSpacing));
  const upperTick = nearestUsableTick(slot0.tick + TICK_RANGE, Number(tickSpacing));

  // 現在価格 (1 WETH = X USDC)
  const ethPriceUSDC = parseFloat(pool.token0Price.toSignificant(6));
  
  // 投資額を半分ずつに分ける (50:50)
  const halfInvestmentUSDC = TOTAL_INVESTMENT_USDC / 2;
  
  // WETHの必要量を計算 (0.5ドル分 / ETH価格)
  const targetEthVal = halfInvestmentUSDC / ethPriceUSDC;

  console.log(`\n--- Calculation ---`);
  console.log(`Price: 1 WETH = ${ethPriceUSDC.toFixed(2)} USDC`);
  console.log(`Plan : ${halfInvestmentUSDC} USDC + ${targetEthVal.toFixed(6)} WETH`);

  // 残高不足チェック (簡易版)
  const requiredUsdcBN = ethers.utils.parseUnits(halfInvestmentUSDC.toFixed(6), 6);
  const requiredWethBN = ethers.utils.parseUnits(targetEthVal.toFixed(18), 18);

  if (usdcBal.lt(requiredUsdcBN) || wethBal.lt(requiredWethBN)) {
    console.error("\n[ERROR] 残高が足りません！");
    console.error(`必要: ${halfInvestmentUSDC} USDC, ${targetEthVal.toFixed(6)} WETH`);
    // 強制終了はしませんが、警告を出します
  }

  const wethAmount = CurrencyAmount.fromRawAmount(
    WETH,
    ethers.utils.parseUnits(targetEthVal.toFixed(18), WETH.decimals).toString()
  );
  const usdcAmount = CurrencyAmount.fromRawAmount(
    USDC,
    ethers.utils.parseUnits(halfInvestmentUSDC.toFixed(6), USDC.decimals).toString()
  );

  const position = Position.fromAmounts({
    pool,
    tickLower: lowerTick,
    tickUpper: upperTick,
    amount0: wethAmount.quotient, 
    amount1: usdcAmount.quotient, 
    useFullPrecision: true,
  });

  console.log(`\nMinting Amounts (SDK Adjusted):`);
  console.log(`  WETH: ${position.mintAmounts.amount0.toString()}`);
  console.log(`  USDC: ${position.mintAmounts.amount1.toString()}`);

  // --- トランザクション準備 ---
  const slippageTolerance = new Percent(50, 10_000); 
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    position,
    {
      slippageTolerance,
      recipient: sender,
      deadline,
    }
  );

  const token0Contract = new ethers.Contract(pool.token0.address, ERC20_ABI.abi, signer);
  const token1Contract = new ethers.Contract(pool.token1.address, ERC20_ABI.abi, signer);
  const swapRouter = new ethers.Contract(SWAP_ROUTER_ADDRESS, SwapRouterABI.abi, signer);

  const mintAmounts = {
    amount0: ethers.BigNumber.from(position.mintAmounts.amount0.toString()),
    amount1: ethers.BigNumber.from(position.mintAmounts.amount1.toString()),
  };

  let balance0 = await token0Contract.balanceOf(sender);
  let balance1 = await token1Contract.balanceOf(sender);

  // --- 残高不足時に自動スワップして調達 ---
  const ensureBalances = async () => {
    // token0 不足なら token1 -> token0 で exactOutputSwap
    if (balance0.lt(mintAmounts.amount0)) {
      const deficit0 = mintAmounts.amount0.sub(balance0);
      const available1 = balance1.gt(mintAmounts.amount1)
        ? balance1.sub(mintAmounts.amount1)
        : ethers.BigNumber.from(0);
      if (available1.lte(0)) {
        throw new Error('Not enough token1 balance to swap for token0.');
      }
      console.log(
        `Swap needed: token0 deficit ${ethers.utils.formatUnits(
          deficit0,
          pool.token0.decimals
        )} | available token1 to swap ${ethers.utils.formatUnits(available1, pool.token1.decimals)}`
      );
      const allowance1 = await token1Contract.allowance(sender, SWAP_ROUTER_ADDRESS);
      if (allowance1.lt(available1)) {
        const txApprove = await token1Contract.approve(SWAP_ROUTER_ADDRESS, MAX_UINT256);
        console.log(`Approve router for ${pool.token1.symbol}: ${txApprove.hash}`);
        await txApprove.wait();
      }
      const txSwap = await swapRouter.exactOutputSingle({
        tokenIn: pool.token1.address,
        tokenOut: pool.token0.address,
        fee: FEE,
        recipient: sender,
        deadline,
        amountOut: deficit0,
        amountInMaximum: available1,
        sqrtPriceLimitX96: 0,
      });
      console.log(
        `Swap token1 -> token0 submitted: ${txSwap.hash} (out=${ethers.utils.formatUnits(
          deficit0,
          pool.token0.decimals
        )}, maxIn=${ethers.utils.formatUnits(available1, pool.token1.decimals)})`
      );
      await txSwap.wait();
      balance0 = await token0Contract.balanceOf(sender);
      balance1 = await token1Contract.balanceOf(sender);
      console.log(
        `Post-swap balances: token0=${ethers.utils.formatUnits(
          balance0,
          pool.token0.decimals
        )}, token1=${ethers.utils.formatUnits(balance1, pool.token1.decimals)}`
      );
    }

    // token1 不足なら token0 -> token1 で exactOutputSwap
    if (balance1.lt(mintAmounts.amount1)) {
      const deficit1 = mintAmounts.amount1.sub(balance1);
      const available0 = balance0.gt(mintAmounts.amount0)
        ? balance0.sub(mintAmounts.amount0)
        : ethers.BigNumber.from(0);
      if (available0.lte(0)) {
        throw new Error('Not enough token0 balance to swap for token1.');
      }
      console.log(
        `Swap needed: token1 deficit ${ethers.utils.formatUnits(
          deficit1,
          pool.token1.decimals
        )} | available token0 to swap ${ethers.utils.formatUnits(available0, pool.token0.decimals)}`
      );
      const allowance0 = await token0Contract.allowance(sender, SWAP_ROUTER_ADDRESS);
      if (allowance0.lt(available0)) {
        const txApprove = await token0Contract.approve(SWAP_ROUTER_ADDRESS, MAX_UINT256);
        console.log(`Approve router for ${pool.token0.symbol}: ${txApprove.hash}`);
        await txApprove.wait();
      }
      const txSwap = await swapRouter.exactOutputSingle({
        tokenIn: pool.token0.address,
        tokenOut: pool.token1.address,
        fee: FEE,
        recipient: sender,
        deadline,
        amountOut: deficit1,
        amountInMaximum: available0,
        sqrtPriceLimitX96: 0,
      });
      console.log(
        `Swap token0 -> token1 submitted: ${txSwap.hash} (out=${ethers.utils.formatUnits(
          deficit1,
          pool.token1.decimals
        )}, maxIn=${ethers.utils.formatUnits(available0, pool.token0.decimals)})`
      );
      await txSwap.wait();
      balance0 = await token0Contract.balanceOf(sender);
      balance1 = await token1Contract.balanceOf(sender);
      console.log(
        `Post-swap balances: token0=${ethers.utils.formatUnits(
          balance0,
          pool.token0.decimals
        )}, token1=${ethers.utils.formatUnits(balance1, pool.token1.decimals)}`
      );
    }

    if (balance0.lt(mintAmounts.amount0) || balance1.lt(mintAmounts.amount1)) {
      throw new Error('Insufficient balances even after swap. Please fund the wallet.');
    }
  };

  // --- ガス代集計用変数 ---
  let totalGasCostETH = ethers.BigNumber.from(0);

  await ensureBalances();

  // 1. Approve Token0
  console.log(`\n1. Approving ${pool.token0.symbol} (token0)...`);
  const tx0 = await token0Contract.approve(NFPM_ADDRESS, mintAmounts.amount0.toString());
  const receipt0 = await tx0.wait();
  totalGasCostETH = totalGasCostETH.add(receipt0.gasUsed.mul(receipt0.effectiveGasPrice));
  console.log(`  -> Approved!`);

  // 2. Approve Token1
  console.log(`2. Approving ${pool.token1.symbol} (token1)...`);
  const tx1 = await token1Contract.approve(NFPM_ADDRESS, mintAmounts.amount1.toString());
  const receipt1 = await tx1.wait();
  totalGasCostETH = totalGasCostETH.add(receipt1.gasUsed.mul(receipt1.effectiveGasPrice));
  console.log(`  -> Approved!`);

  // 3. Mint Position
  console.log(`3. Minting Position...`);
  const txMint = await signer.sendTransaction({
    to: NFPM_ADDRESS,
    data: calldata,
    value,
  });
  console.log(`  Tx Hash: ${txMint.hash}`);
  
  const receiptMint = await txMint.wait();
  totalGasCostETH = totalGasCostETH.add(receiptMint.gasUsed.mul(receiptMint.effectiveGasPrice));

  // --- ログ解析してTokenIDと実際の投入量を取得 ---
  const nfpmInterface = new ethers.utils.Interface(NFPM_ABI.abi);
  let mintedTokenId = 'Unknown';
  let amount0Added = ethers.BigNumber.from(0);
  let amount1Added = ethers.BigNumber.from(0);

  for (const log of receiptMint.logs) {
    try {
      const parsed = nfpmInterface.parseLog(log);
      if (parsed.name === 'IncreaseLiquidity') {
        mintedTokenId = parsed.args.tokenId.toString();
        amount0Added = parsed.args.amount0;
        amount1Added = parsed.args.amount1;
        break;
      }
    } catch (e) {
      // 無関係なログは無視
    }
  }

  // --- 数値計算とレポート作成 ---
  const totalGasETHFloat = parseFloat(ethers.utils.formatEther(totalGasCostETH));
  const totalGasUSDC = totalGasETHFloat * ethPriceUSDC;

  // 実際に投入された量 (Float)
  const val0 = parseFloat(ethers.utils.formatUnits(amount0Added, 18)); // WETH
  const val1 = parseFloat(ethers.utils.formatUnits(amount1Added, 6));  // USDC
  
  // ポジション総額 (USDC換算)
  const positionValueUSDC = (val0 * ethPriceUSDC) + val1;

  console.log(`\n====== 完了レポート ======`);
  console.log(`[ポジション情報]`);
  console.log(`  Status   : Success`);
  console.log(`  Token ID : ${mintedTokenId}`);
  console.log(`  Block    : ${receiptMint.blockNumber}`);
  console.log(`--------------------------`);
  console.log(`[ポジションサイズ (実測値)]`);
  console.log(`  WETH     : ${val0.toFixed(6)} WETH`);
  console.log(`  USDC     : ${val1.toFixed(6)} USDC`);
  console.log(`  合計価値 : ${positionValueUSDC.toFixed(4)} USDC`);
  console.log(`  (目標値  : ${TOTAL_INVESTMENT_USDC.toFixed(4)} USDC)`);
  console.log(`--------------------------`);
  console.log(`[コスト集計]`);
  console.log(`  Gas (ETH): ${totalGasETHFloat.toFixed(6)} ETH`);
  console.log(`  Gas (USDC): ${totalGasUSDC.toFixed(4)} USDC (approx)`);
  console.log(`==========================\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
