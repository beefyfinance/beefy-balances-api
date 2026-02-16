import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
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
  balanceMap: Map<string, Map<string, Decimal>>;
  tokenMetadata: TokenMetadata[];
};

/**
 * Fetches token balances at an exact block by combining the last daily snapshot
 * with balance changes between the snapshot and target block (streaming replay).
 * Also fetches token metadata (id, address, name, symbol, decimals).
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
  const tokenIn = tokenAddresses.map(a => getTokenId({ chainId, address: a }));
  if (tokenIn.length === 0) {
    throw new FriendlyError(`No token addresses provided for chain ${chainId}`);
  }
  const accountNotIn =
    excludeAccounts.length > 0
      ? excludeAccounts.map(a => getAccountId({ chainId, address: a }))
      : [getAccountId({ chainId, address: '0x0000000000000000000000000000000000000000' as Hex })];

  const [lastSnapshotRes, metadataMerged] = await Promise.all([
    sdk.TokenBalanceSnapshotLastDailySnapshotAtBlock({
      networkId: networkId,
      block: targetBlockStr,
    }),
    paginate({
      fetchPage: ({ offset, limit }) =>
        sdk.TokenMetadata({
          token_in: tokenIn,
          tokenOffset: offset,
          tokenLimit: limit,
        }),
      count: res => res.data.Token.length,
      merge: (a, b) => ({
        ...a,
        data: {
          ...a.data,
          Token: [...(a.data?.Token ?? []), ...(b.data?.Token ?? [])],
        },
      }),
    }),
  ]);

  const meta = lastSnapshotRes.data?._meta?.at(0);
  const lastProcessedBlock = meta?.progressBlock != null ? BigInt(meta.progressBlock) : null;
  if (lastProcessedBlock === null || lastProcessedBlock < targetBlock) {
    throw new FriendlyError(
      `Indexer has not processed up to block ${targetBlockStr} for chain ${chainId} (last processed block: ${lastProcessedBlock?.toString() ?? 'unknown'})`
    );
  }

  const tokenMetadata: TokenMetadata[] = (metadataMerged.data?.Token ?? []).map(t => ({
    id: t.id,
    address: t.address?.toLowerCase() ?? t.id,
    name: t.name ?? null,
    symbol: t.symbol ?? null,
    decimals: t.decimals,
  }));

  if (lastSnapshotRes.errors?.length) {
    throw new FriendlyError(
      `TokenBalanceSnapshotLastDailySnapshotAtBlock failed: ${lastSnapshotRes.errors.map((e: { message: string }) => e.message).join(', ')}`
    );
  }

  const lastSnapshotBlockStr = (lastSnapshotRes.data?.TokenBalanceSnapshot ?? [])?.at(
    0
  )?.blockNumber;
  if (!lastSnapshotBlockStr) {
    throw new FriendlyError(
      `No daily snapshot found for chain ${chainId} at or before block ${targetBlockStr}`
    );
  }

  const lastSnapshotBlock = BigInt(lastSnapshotBlockStr);
  const balances = new Map<string, Map<string, Decimal>>();

  const balanceSnapshots = await paginate({
    fetchPage: ({ offset, limit }) =>
      sdk.TokenBalanceSnapshotAtBlock({
        networkId: networkId,
        token_in: tokenIn,
        account_not_in: accountNotIn,
        snapshotBlock: lastSnapshotBlock.toString(),
        offset,
        limit,
      }),
    count: res => res.data?.TokenBalanceSnapshot?.length ?? 0,
    merge: (a, b) => ({
      ...a,
      data: {
        ...a.data,
        TokenBalanceSnapshot: [
          ...(a.data?.TokenBalanceSnapshot ?? []),
          ...(b.data?.TokenBalanceSnapshot ?? []),
        ],
      },
    }),
  });

  for (const row of balanceSnapshots.data?.TokenBalanceSnapshot ?? []) {
    const tid = row.token_id.toLowerCase();
    const aid = row.account_id.toLowerCase();
    let byAccount = balances.get(tid);
    if (!byAccount) {
      byAccount = new Map();
      balances.set(tid, byAccount);
    }
    byAccount.set(aid, new Decimal(row.amount));
  }

  const changesMerged = await paginate({
    fetchPage: ({ offset, limit }) =>
      sdk.TokenBalanceChangesBetweenBlocks({
        networkId: networkId,
        token_in: tokenIn,
        account_not_in: accountNotIn,
        block_gt: lastSnapshotBlock.toString(),
        block_lte: targetBlockStr,
        offset,
        limit,
      }),
    count: res => res.data?.TokenBalanceChange?.length ?? 0,
    merge: (a, b) => ({
      ...a,
      data: {
        ...a.data,
        TokenBalanceChange: [
          ...(a.data?.TokenBalanceChange ?? []),
          ...(b.data?.TokenBalanceChange ?? []),
        ],
      },
    }),
  });

  // sum up the diffs so we don't care about the order we apply them in
  for (const change of changesMerged.data?.TokenBalanceChange ?? []) {
    const tid = change.token_id.toLowerCase();
    const aid = change.account_id.toLowerCase();
    const diff = new Decimal(change.balanceAfter).minus(change.balanceBefore);
    let byAccount = balances.get(tid);
    if (!byAccount) {
      byAccount = new Map();
      balances.set(tid, byAccount);
    }
    const current = byAccount.get(aid) ?? new Decimal(0);
    byAccount.set(aid, current.plus(diff));
  }

  return { balanceMap: balances, tokenMetadata };
}
