import { ethers } from 'ethers';
import { Pool, Position } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
import NFPM_ABI from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import PoolABI from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import IERC20_METADATA_ABI from '@uniswap/v3-periphery/artifacts/contracts/interfaces/IERC20Metadata.sol/IERC20Metadata.json';

// --- 設定 ---
const RPC_WSS = process.env.RPC_WSS ?? '';
const RPC_URL = process.env.RPC_URL ?? 'https://arb1.arbitrum.io/rpc';
const TOKEN_ID = process.env.TOKEN_ID;
const NFPM_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const POOL_ADDRESS = process.env.POOL_ADDRESS ?? '0xC6962004f452bE9203591991D15f6b388e09E8D0'; 
const CHAIN_ID = 42161; 
const UPDATE_INTERVAL_MS = 5000; 

// uint128最大値
const MAX_UINT128 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffff');

function requireEnv() {
  if (!RPC_WSS) throw new Error('RPC_WSS missing');
  if (!RPC_URL) throw new Error('RPC_URL missing');
  if (!TOKEN_ID) throw new Error('TOKEN_ID missing');
}

async function main() {
  requireEnv();
  
  // プロバイダー分離（安定化対策）
  const wsProvider = new ethers.providers.WebSocketProvider(RPC_WSS);
  const httpProvider = new ethers.providers.JsonRpcProvider(RPC_URL);

  // データ取得用 (HTTP)
  const nfpm = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, httpProvider);
  const poolContract = new ethers.Contract(POOL_ADDRESS, PoolABI.abi, httpProvider);
  
  // イベント監視用 (WSS)
  const nfpmWs = new ethers.Contract(NFPM_ADDRESS, NFPM_ABI.abi, wsProvider);
  const poolWs = new ethers.Contract(POOL_ADDRESS, PoolABI.abi, wsProvider);

  const tokenIdBN = ethers.BigNumber.from(TOKEN_ID);

  // 1. Owner確認
  const ownerAddress = await nfpm.ownerOf(tokenIdBN);
  console.log(`Detected Owner: ${ownerAddress}`);

  // トークン情報
  const [token0Addr, token1Addr, fee] = await Promise.all([
    poolContract.token0(), poolContract.token1(), poolContract.fee()
  ]);
  const token0Contract = new ethers.Contract(token0Addr, IERC20_METADATA_ABI.abi, httpProvider);
  const token1Contract = new ethers.Contract(token1Addr, IERC20_METADATA_ABI.abi, httpProvider);
  const [dec0, dec1, sym0, sym1] = await Promise.all([
    token0Contract.decimals(), token1Contract.decimals(),
    token0Contract.symbol(), token1Contract.symbol()
  ]);

  const TOKEN0 = new Token(CHAIN_ID, token0Addr, dec0, sym0);
  const TOKEN1 = new Token(CHAIN_ID, token1Addr, dec1, sym1);

  console.log(`\n=== リアルタイムLP監視 (詳細分析版) ===`);
  console.log(`Target: TokenID ${TOKEN_ID} (${sym0}/${sym1})`);

  let lastUpdateTime = 0;
  let isUpdating = false;

  const reportState = async (trigger: string) => {
    if (isUpdating) return;
    isUpdating = true;

    try {
      // データ取得 (HTTP)
      const [posData, slot0, liquidity] = await Promise.all([
        nfpm.positions(tokenIdBN),
        poolContract.slot0(),
        poolContract.liquidity()
      ]);

      const pool = new Pool(TOKEN0, TOKEN1, fee, slot0.sqrtPriceX96.toString(), liquidity.toString(), slot0.tick);
      const position = new Position({
        pool, liquidity: posData.liquidity.toString(),
        tickLower: posData.tickLower, tickUpper: posData.tickUpper
      });

      // --- 1. ポジション価値の計算 ---
      const amount0 = parseFloat(position.amount0.toSignificant(6));
      const amount1 = parseFloat(position.amount1.toSignificant(6));
      const price0 = parseFloat(pool.token0Price.toSignificant(6));
      
      const val0_in_1 = amount0 * price0;
      const totalVal = val0_in_1 + amount1; // ★現在のポジション総額 (USDC換算)

      let ratio0 = totalVal > 0 ? (val0_in_1 / totalVal) * 100 : 0;
      let ratio1 = totalVal > 0 ? (amount1 / totalVal) * 100 : 0;

      // --- 2. 手数料の計算 ---
      let feesText = "Fetching...";
      try {
        const feeResult = await nfpm.callStatic.collect({
          tokenId: TOKEN_ID, 
          recipient: ownerAddress, 
          amount0Max: MAX_UINT128, 
          amount1Max: MAX_UINT128
        }, { from: ownerAddress });

        const f0 = parseFloat(ethers.utils.formatUnits(feeResult.amount0, dec0));
        const f1 = parseFloat(ethers.utils.formatUnits(feeResult.amount1, dec1));
        
        // 手数料の総額 (USDC換算)
        const totalFeeUSDC = (f0 * price0) + f1;
        
        // ★対ポジション比率 (%) 計算
        const feeYield = totalVal > 0 ? (totalFeeUSDC / totalVal) * 100 : 0;

        feesText = `+${f0.toFixed(6)} ${sym0} / +${f1.toFixed(6)} ${sym1}\n        (Total: $${totalFeeUSDC.toFixed(4)} | Yield: +${feeYield.toFixed(3)}%)`;

      } catch (e) {
        feesText = "(Calc Failed)"; 
      }

      // --- 3. 範囲外判定 ---
      const currentTick = slot0.tick;
      const tickLower = posData.tickLower;
      const tickUpper = posData.tickUpper;
      
      let statusHeader = "✅ Active";
      if (currentTick < tickLower) statusHeader = `🚨 LOW RANGE (${sym0} 100%)`;
      else if (currentTick > tickUpper) statusHeader = `🚨 HIGH RANGE (${sym1} 100%)`;

      // --- 4. 表示 ---
      const timestamp = new Date().toLocaleTimeString();
      console.log(`\n[${timestamp}] ${trigger} | ${statusHeader}`);
      console.log(`Price : 1 ${sym0} = ${price0.toFixed(2)} ${sym1}`);
      
      const barLength = 20;
      const barFilled = Math.round(ratio0 / 100 * barLength);
      const bar0 = '█'.repeat(barFilled);
      const bar1 = '░'.repeat(barLength - barFilled);
      
      console.log(`Asset : |${bar0}${bar1}| ${sym0}:${ratio0.toFixed(0)}% ${sym1}:${ratio1.toFixed(0)}%`);
      
      // ★Valueにトータル換算を追加
      console.log(`Value : ${amount0.toFixed(4)} ${sym0} + ${amount1.toFixed(2)} ${sym1}`);
      console.log(`        (Total: $${totalVal.toFixed(2)})`);
      
      // ★Feesに％を追加
      console.log(`Fees  : ${feesText}`);

    } catch (e) {
      console.error('Update Error:', e);
    } finally {
      isUpdating = false;
      lastUpdateTime = Date.now();
    }
  };

  await reportState('Init');

  // イベント監視 (WSS)
  poolWs.on(poolWs.filters.Swap(), async () => {
    const now = Date.now();
    if (now - lastUpdateTime > UPDATE_INTERVAL_MS && !isUpdating) {
      await reportState('Swap');
    }
  });
  
  const topic = ethers.utils.hexZeroPad(tokenIdBN.toHexString(), 32);
  nfpmWs.on(nfpmWs.filters.IncreaseLiquidity(topic), () => reportState('Liq+'));
  nfpmWs.on(nfpmWs.filters.DecreaseLiquidity(topic), () => reportState('Liq-'));
  nfpmWs.on(nfpmWs.filters.Collect(topic), () => reportState('Collect'));

  // WS接続エラー対策
  // @ts-ignore
  wsProvider._websocket.on('close', () => {
    console.error('WS Closed. Exiting...');
    process.exit(1);
  });
}

main().catch(console.error);