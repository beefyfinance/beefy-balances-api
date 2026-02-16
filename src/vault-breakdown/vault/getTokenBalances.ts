import type { Hex } from 'viem';
import type { ChainId } from '../../config/chains';
import { getLoggerFor } from '../../utils/log';
import { getTokenBalancesAtBlock } from '../../utils/token-balance-at-block';
import { getViemClient } from '../../utils/viemClient';

type TokenBalance = {
  user_address: Hex;
  token_address: Hex;
  balance: bigint;
};

const logger = getLoggerFor('vault-breakdown/vault/getTokenBalances');

export const getTokenBalances = async (
  chainId: ChainId,
  filters: {
    blockNumber?: bigint;
    tokenAddresses?: Hex[];
    minBalance?: bigint;
  }
): Promise<TokenBalance[]> => {
  const startAt = Date.now();

  const targetBlock = filters.blockNumber ?? (await getViemClient(chainId).getBlockNumber());

  logger.debug({
    msg: 'Fetching user balances',
    chainId,
    filters,
    targetBlock: targetBlock.toString(),
  });

  const tokenAddresses = filters.tokenAddresses ?? [];
  const { balanceMap, tokenMetadata } = await getTokenBalancesAtBlock({
    chainId,
    targetBlock,
    tokenAddresses,
  });

  const tokenIdToAddress = new Map(
    tokenMetadata.map(t => [t.id.toLowerCase(), t.address.toLowerCase() as Hex])
  );

  const allPositions: TokenBalance[] = [];
  for (const [tokenId, byAccount] of balanceMap) {
    const tokenAddress = tokenIdToAddress.get(tokenId);
    if (!tokenAddress) continue;

    for (const [accountId, amount] of byAccount) {
      const balance = BigInt(amount.floor().toFixed(0));
      if (filters.minBalance != null && balance < filters.minBalance) continue;
      allPositions.push({
        user_address: accountId as Hex,
        token_address: tokenAddress,
        balance,
      });
    }
  }

  logger.debug({
    msg: 'Fetched user balances',
    positions: allPositions.length,
    chainId,
    filters,
    duration: Date.now() - startAt,
  });

  return allPositions;
};
