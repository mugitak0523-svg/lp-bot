import { BigNumber, Contract, Signer } from 'ethers';
import SwapRouterABI from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json';

import { SWAP_ROUTER_ADDRESS } from './addresses';

export function getSwapRouter(signer: Signer): Contract {
  return new Contract(SWAP_ROUTER_ADDRESS, SwapRouterABI.abi, signer);
}

export async function swapExactInputSingle(params: {
  router: Contract;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: BigNumber;
  amountOutMinimum: BigNumber;
  deadline: number;
}): Promise<string> {
  const tx = await params.router.exactInputSingle({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    fee: params.fee,
    recipient: params.recipient,
    deadline: params.deadline,
    amountIn: params.amountIn,
    amountOutMinimum: params.amountOutMinimum,
    sqrtPriceLimitX96: 0,
  });
  const receipt = await tx.wait();
  return receipt.transactionHash;
}
