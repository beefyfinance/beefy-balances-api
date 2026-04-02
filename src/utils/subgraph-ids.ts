import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { getNetworkIdFromChainId } from './viemClient';

/**
 * Token id in the subgraph: `<networkId>-<tokenAddress>`.
 * Use when building token_in filters or when you need the canonical token id.
 */
export function getTokenId({
  chainId,
  address,
}: {
  chainId: ChainId;
  address: Hex;
}): string {
  const networkId = getNetworkIdFromChainId(chainId);
  const normalized = address.toLowerCase();
  return `${networkId}-${normalized}`;
}

/**
 * Account id in the subgraph. Currently the account address only;
 * use this helper so we can change the format later (e.g. to `<networkId>-<address>`).
 */
export function getAccountId({
  chainId: _chainId,
  address,
}: {
  chainId: ChainId;
  address: Hex;
}): string {
  return address.toLowerCase();
}
