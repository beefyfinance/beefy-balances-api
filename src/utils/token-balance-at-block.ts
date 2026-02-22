import Decimal from 'decimal.js';
import * as R from 'remeda';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { decimalToBigInt } from './decimal';
import { FriendlyError } from './error';
import { getGlobalSdk, paginate } from './sdk';
import { getAccountId, getTokenId } from './subgraph-ids';
import { getNetworkIdFromChainId } from './viemClient';

export type TokenMetadata = {
  id: string;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
};

export type TokenBalancesAtBlockResult = {
  balances: {
    tokenAddress: Hex;
    accountAddress: Hex;
    balanceDecimal: Decimal;
    balanceRaw: bigint;
  }[];
  tokenMetadata: TokenMetadata[];
};

/**
 * Fetches token balances at an exact block using the BalanceAtBlock query
 * (last change at or before the block per token/account). Also fetches token metadata.
 */
export async function getTokenBalancesAtBlock(options: {
  chainId: ChainId;
  targetBlock: bigint;
  tokenAddresses: Hex[];
  excludeAccounts?: Hex[];
}): Promise<TokenBalancesAtBlockResult> {
  const { chainId, targetBlock, tokenAddresses, excludeAccounts = [] } = options;

  const sdk = getGlobalSdk();
  const networkId = getNetworkIdFromChainId(chainId);
  const targetBlockStr = targetBlock.toString();
  const tokenIdIn = tokenAddresses.map(a => getTokenId({ chainId, address: a }));
  const tokenAddressesLower = tokenAddresses.map(a => a.toLowerCase());
  if (tokenAddressesLower.length === 0) {
    throw new FriendlyError(`No token addresses provided for chain ${chainId}`);
  }
  const accountNotIn =
    excludeAccounts.length > 0
      ? excludeAccounts.map(a => getAccountId({ chainId, address: a }))
      : [getAccountId({ chainId, address: '0x0000000000000000000000000000000000000000' as Hex })];

  const res = await paginate({
    fetchPage: ({ offset, limit }) =>
      sdk.BalanceAtBlock({
        networkId,
        tokenId_in: tokenIdIn,
        account_not_in: accountNotIn,
        block: targetBlockStr,
        offset,
        limit,
      }),
    count: res => res.data?.TokenBalance?.length ?? 0,
    merge: (a, b) => ({
      ...a,
      data: {
        _meta: a.data?._meta, // only keep the first meta
        Token: a.data?.Token, // only keep the first token metadata, it will always be the same
        TokenBalance: [...(a.data?.TokenBalance ?? []), ...(b.data?.TokenBalance ?? [])],
      },
    }),
  });

  const lastProcessedBlock = res.data._meta?.[0]?.progressBlock
    ? BigInt(res.data._meta?.[0]?.progressBlock)
    : null;
  if (lastProcessedBlock === null || lastProcessedBlock < targetBlock) {
    throw new FriendlyError(
      `Indexer has not processed up to block ${targetBlockStr} for chain ${chainId} (last processed block: ${lastProcessedBlock?.toString() ?? 'unknown'})`
    );
  }

  const tokenMetadata: TokenMetadata[] = (res.data?.Token ?? []).map(t => ({
    id: t.id,
    address: t.address?.toLowerCase() ?? t.id,
    name: t.name ?? null,
    symbol: t.symbol ?? null,
    decimals: t.decimals,
  }));

  return {
    balances: R.pipe(
      res.data?.TokenBalance ?? [],
      R.map(row => {
        const tokenAddress = (row.token?.address?.toLowerCase() as Hex) ?? '';
        const accountAddress = (row.account?.address?.toLowerCase() as Hex) ?? '';
        const balanceStr = row.lastChange?.at(0)?.balanceAfter ?? '0';
        return {
          tokenAddress,
          accountAddress,
          balanceStr,
        };
      }),
      R.filter(e => e.balanceStr !== '0'),
      R.map(e => {
        const Token = tokenMetadata.find(t => t.address === e.tokenAddress);
        if (!Token) {
          throw new FriendlyError(`Token ${e.tokenAddress} not found in token metadata`);
        }
        if (!Token.decimals) {
          throw new FriendlyError(`Token ${e.tokenAddress} has no decimals`);
        }
        return {
          tokenAddress: e.tokenAddress,
          accountAddress: e.accountAddress,
          balanceDecimal: new Decimal(e.balanceStr),
          balanceRaw: decimalToBigInt(new Decimal(e.balanceStr), Token.decimals),
        };
      })
    ),
    tokenMetadata,
  };
}
