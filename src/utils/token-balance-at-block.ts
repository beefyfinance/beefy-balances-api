import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { FriendlyError } from './error';
import { getGlobalSdk, paginate } from './sdk';
import { getViemClient } from './viemClient';

/**
 * Fetches token balances at an exact block by combining the last daily snapshot
 * with balance changes between the snapshot and target block (streaming replay).
 * Returns a nested map: tokenId -> accountId -> balance (Decimal).
 */
export async function getTokenBalancesAtBlock(options: {
  chainId: ChainId;
  targetBlock: bigint;
  tokenAddresses: Hex[];
  excludeAccounts?: Hex[];
}): Promise<Map<string, Map<string, Decimal>>> {
  const { chainId, targetBlock, tokenAddresses, excludeAccounts = [] } = options;

  const sdk = getGlobalSdk();
  const numericChainId = getViemClient(chainId).chain.id;
  const targetBlockStr = targetBlock.toString();
  const tokenIn = tokenAddresses.map(a => a.toLowerCase());
  const accountNotIn = excludeAccounts.length
    ? excludeAccounts.map(a => a.toLowerCase())
    : ['0x0000000000000000000000000000000000000000'];

  const lastSnapshotRes = await sdk.TokenBalanceSnapshotLastDailySnapshotAtBlock({
    chainId: numericChainId,
    block: targetBlockStr,
  });

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
    fetchPage: ({ skip, first }) =>
      sdk.TokenBalanceSnapshotAtBlock({
        chainId: numericChainId,
        token_in: tokenIn,
        account_not_in: accountNotIn,
        snapshotBlock: lastSnapshotBlock.toString(),
        offset: skip,
        limit: first,
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
    fetchPage: ({ skip, first }) =>
      sdk.TokenBalanceChangesBetweenBlocks({
        chainId: numericChainId,
        token_in: tokenIn,
        account_not_in: accountNotIn,
        block_gt: lastSnapshotBlock.toString(),
        block_lte: targetBlockStr,
        offset: skip,
        limit: first,
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

  return balances;
}
