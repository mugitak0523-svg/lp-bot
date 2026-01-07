import { BigNumber, Contract, ContractReceipt, Signer, utils } from 'ethers';
import NFPM_ABI from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import { NonfungiblePositionManager, Position } from '@uniswap/v3-sdk';
import { Percent } from '@uniswap/sdk-core';

import { NFPM_ADDRESS } from './addresses';

const MAX_UINT128 = BigNumber.from('0xffffffffffffffffffffffffffffffff');

export function getPositionManager(signer: Signer): Contract {
  return new Contract(NFPM_ADDRESS, NFPM_ABI.abi, signer);
}

export async function decreaseLiquidity(
  nfpm: Contract,
  tokenId: string,
  liquidity: BigNumber,
  deadline: number
): Promise<ContractReceipt> {
  const tx = await nfpm.decreaseLiquidity({
    tokenId,
    liquidity,
    amount0Min: 0,
    amount1Min: 0,
    deadline,
  });
  return tx.wait();
}

export async function collectAll(
  nfpm: Contract,
  tokenId: string,
  recipient: string
): Promise<ContractReceipt> {
  const tx = await nfpm.collect({
    tokenId,
    recipient,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  return tx.wait();
}

export function buildMintCall(
  position: Position,
  recipient: string,
  slippageBps: number,
  deadline: number
): { calldata: string; value: string } {
  const slippage = new Percent(slippageBps, 10_000);
  return NonfungiblePositionManager.addCallParameters(position, {
    slippageTolerance: slippage,
    recipient,
    deadline,
  });
}

export function parseEventAmounts(receipt: ContractReceipt): {
  amount0: BigNumber;
  amount1: BigNumber;
  tokenId?: string;
} {
  const iface = new utils.Interface(NFPM_ABI.abi);
  let amount0 = BigNumber.from(0);
  let amount1 = BigNumber.from(0);
  let tokenId: string | undefined;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === 'DecreaseLiquidity' || parsed.name === 'Collect' || parsed.name === 'IncreaseLiquidity') {
        amount0 = amount0.add(parsed.args.amount0);
        amount1 = amount1.add(parsed.args.amount1);
        if (parsed.args.tokenId) {
          tokenId = parsed.args.tokenId.toString();
        }
      }
    } catch {
      // ignore non-NFPM logs
    }
  }

  return { amount0, amount1, tokenId };
}
