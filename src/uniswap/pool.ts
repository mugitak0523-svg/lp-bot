import { Contract } from 'ethers';
import { Provider } from '@ethersproject/providers';
import { Pool } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';

import { getErc20Metadata } from './erc20';

export type PoolContext = {
  pool: Pool;
  token0: Token;
  token1: Token;
  fee: number;
  tickSpacing: number;
  slot0: { sqrtPriceX96: string; tick: number };
  liquidity: string;
};

export async function loadPoolContext(
  provider: Provider,
  poolAddress: string,
  chainId: number
): Promise<PoolContext> {
  const poolContract = new Contract(poolAddress, IUniswapV3PoolABI.abi, provider);
  const [token0Addr, token1Addr, fee, tickSpacing, slot0, liquidity] = await Promise.all([
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
    poolContract.tickSpacing(),
    poolContract.slot0(),
    poolContract.liquidity(),
  ]);

  const [token0Meta, token1Meta] = await Promise.all([
    getErc20Metadata(token0Addr, provider),
    getErc20Metadata(token1Addr, provider),
  ]);

  const token0 = new Token(chainId, token0Addr, token0Meta.decimals, token0Meta.symbol);
  const token1 = new Token(chainId, token1Addr, token1Meta.decimals, token1Meta.symbol);

  const pool = new Pool(
    token0,
    token1,
    fee,
    slot0.sqrtPriceX96.toString(),
    liquidity.toString(),
    slot0.tick
  );

  return {
    pool,
    token0,
    token1,
    fee,
    tickSpacing: Number(tickSpacing),
    slot0: { sqrtPriceX96: slot0.sqrtPriceX96.toString(), tick: slot0.tick },
    liquidity: liquidity.toString(),
  };
}
