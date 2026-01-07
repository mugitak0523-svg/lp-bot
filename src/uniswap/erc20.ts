import { BigNumber, Contract, Signer } from 'ethers';
import { Provider } from '@ethersproject/providers';
import IERC20Metadata from '@uniswap/v3-periphery/artifacts/contracts/interfaces/IERC20Metadata.sol/IERC20Metadata.json';

const MAX_UINT256 = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

export type Erc20Metadata = {
  symbol: string;
  decimals: number;
};

export function getErc20(address: string, signerOrProvider: Signer | Provider): Contract {
  return new Contract(address, IERC20Metadata.abi, signerOrProvider);
}

export async function getErc20Metadata(address: string, provider: Provider): Promise<Erc20Metadata> {
  const contract = getErc20(address, provider);
  const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);
  return { symbol, decimals };
}

export async function ensureAllowance(
  token: Contract,
  owner: string,
  spender: string,
  amount: BigNumber
): Promise<void> {
  const allowance: BigNumber = await token.allowance(owner, spender);
  if (allowance.gte(amount)) return;
  const tx = await token.approve(spender, MAX_UINT256);
  await tx.wait();
}
