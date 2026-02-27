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
  const { balances } = await getTokenBalancesAtBlock({
    chainId,
    targetBlock,
    tokenAddresses,
  });

  logger.debug({
    msg: 'Fetched user balances',
    positions: balances.length,
    chainId,
    filters,
    duration: Date.now() - startAt,
  });

  return balances
    .filter(b => b.balanceRaw >= (filters.minBalance ?? 0n))
    .map(b => ({
      user_address: b.accountAddress,
      token_address: b.tokenAddress,
      balance: b.balanceRaw,
    }));
};
