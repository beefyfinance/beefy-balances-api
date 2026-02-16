import { type Static, Type } from '@sinclair/typebox';
import type Decimal from 'decimal.js';
import { uniq } from 'lodash';
import * as R from 'remeda';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { addressSchema } from '../schema/address';
import {
  type BeefyVault,
  getBeefyBreakdownableVaultConfig,
} from '../vault-breakdown/vault/getBeefyVaultConfig';
import { FriendlyError } from './error';
import { getTokenBalancesAtBlock } from './token-balance-at-block';

// Define schemas
export const tokenBalancesSchema = Type.Object({
  id: addressSchema,
  name: Type.String(),
  symbol: Type.String(),
  decimals: Type.Number(),
  balances: Type.Array(Type.Object({ balance: Type.String(), holder: addressSchema })),
});

export const vaultHoldersSchema = Type.Array(tokenBalancesSchema);
export type VaultHolders = Static<typeof vaultHoldersSchema>;

type HolderWithDetails = {
  holder: string;
  balance: string | bigint;
  hold_details: Array<{ token: Hex; balance: string }>;
};

export const getVaultHoldersAsBaseVaultEquivalentForVaultAddress = async (
  chainId: ChainId,
  vault_address: Hex,
  block: bigint,
  balanceGt = 0n
) => {
  // first get the addresses linked to that vault id
  const configs = await getBeefyBreakdownableVaultConfig(
    chainId,
    vault => vault.vault_address.toLowerCase() === vault_address.toLowerCase()
  );
  if (!configs.length) {
    throw new FriendlyError(`Vault with "vault_address" ${vault_address} not found`);
  }
  if (configs.length > 1) {
    throw new FriendlyError(`Vault with "vault_address" ${vault_address} is not unique`);
  }

  return _getVaultHoldersAsBaseVaultEquivalent(chainId, configs[0], block, balanceGt);
};

export const getVaultHoldersAsBaseVaultEquivalentForStrategyAddress = async (
  chainId: ChainId,
  strategy_address: Hex,
  block: bigint,
  balanceGt = 0n
) => {
  // first get the addresses linked to that vault id
  const configs = await getBeefyBreakdownableVaultConfig(
    chainId,
    vault => vault.strategy_address.toLowerCase() === strategy_address.toLowerCase()
  );
  if (!configs.length) {
    throw new FriendlyError(`Vault with "strategy_address" ${strategy_address} not found`);
  }
  if (configs.length > 1) {
    throw new FriendlyError(`Vault with "strategy_address" ${strategy_address} is not unique`);
  }

  return _getVaultHoldersAsBaseVaultEquivalent(chainId, configs[0], block, balanceGt);
};

export const getVaultHoldersAsBaseVaultEquivalentForVaultId = async (
  chainId: ChainId,
  vault_id: string,
  block: bigint,
  balanceGt = 0n
) => {
  // first get the addresses linked to that vault id
  const configs = await getBeefyBreakdownableVaultConfig(chainId, vault => vault.id === vault_id);
  if (!configs.length) {
    throw new FriendlyError(`Vault with "id" ${vault_id} not found`);
  }
  if (configs.length > 1) {
    throw new FriendlyError(`Vault with "id" ${vault_id} is not unique`);
  }

  return _getVaultHoldersAsBaseVaultEquivalent(chainId, configs[0], block, balanceGt);
};

type BalanceEntry = { balance: string; holder: string };
type BalancesByContract = Record<
  string,
  { id: string; name: string; symbol: string; decimals: number; balances: BalanceEntry[] }
>;

/** Maps balance entries to HolderWithDetails for a given token address. */
const withHoldDetails = (balances: BalanceEntry[], tokenAddress: Hex): HolderWithDetails[] =>
  R.pipe(
    balances,
    R.map(e => ({
      ...e,
      hold_details: [{ token: tokenAddress, balance: e.balance }],
    }))
  );

/** Gets balances for a contract from balancesByContract and wraps with hold_details. */
const getHoldersWithDetails = (
  balancesByContract: BalancesByContract,
  tokenAddress: Hex
): HolderWithDetails[] =>
  withHoldDetails(balancesByContract[tokenAddress.toLowerCase()]?.balances ?? [], tokenAddress);

/** Aggregates holders: group by holder (lowercase), sum balance, concat hold_details. */
const aggregateByHolder = (holders: HolderWithDetails[]) =>
  R.pipe(
    holders,
    R.groupBy((e: HolderWithDetails) => e.holder.toLowerCase()),
    R.entries(),
    R.map(([holder, balances]) => ({
      holder,
      balance: R.reduce(
        balances,
        (acc: bigint, curr: HolderWithDetails) => acc + BigInt(curr.balance),
        0n
      ),
      hold_details: R.flatMap(balances, (e: HolderWithDetails) => e.hold_details),
    }))
  );

const _getVaultHoldersAsBaseVaultEquivalent = async (
  chainId: ChainId,
  config: BeefyVault,
  block: bigint,
  balanceGt = 0n
) => {
  const tokens = R.pipe(
    config.protocol_type === 'beefy_clm_vault'
      ? [
          config.vault_address,
          config.beefy_clm_manager.vault_address,
          ...R.flatMap(config.beefy_clm_manager.reward_pools, pool => pool.reward_pool_address),
          ...R.flatMap(config.beefy_clm_manager.boosts, boost => boost.boost_address),
          ...R.flatMap(config.reward_pools, pool => pool.reward_pool_address),
          ...R.flatMap(config.boosts, boost => boost.boost_address),
        ]
      : [
          config.vault_address,
          ...R.flatMap(config.reward_pools, pool => pool.reward_pool_address),
          ...R.flatMap(config.boosts, boost => boost.boost_address),
        ],
    R.map(address => address.toLowerCase() as Hex),
    R.unique()
  );

  const strategies = R.pipe(
    config.protocol_type === 'beefy_clm_vault'
      ? [config.strategy_address, config.beefy_clm_manager.strategy_address]
      : [config.strategy_address],
    R.map(address => address.toLowerCase()),
    R.unique()
  );
  const excludeHolders = R.unique([...strategies, ...tokens]);

  const { balanceMap, tokenMetadata } = await getTokenBalancesAtBlock({
    chainId,
    targetBlock: block,
    tokenAddresses: tokens as Hex[],
    excludeAccounts: excludeHolders as Hex[],
  });

  const balancesByContract = R.pipe(
    tokenMetadata,
    R.map(meta => {
      if (!meta.symbol) throw new FriendlyError(`Token ${meta.id} has no symbol`);
      if (!meta.name) throw new FriendlyError(`Token ${meta.id} has no name`);
      const byAccount = balanceMap.get(meta.id.toLowerCase()) ?? new Map<string, Decimal>();
      const balances = R.pipe(
        Array.from(byAccount.entries()),
        R.map(([holder, decimal]) => ({ balance: decimal.toString(), holder })),
        R.filter(({ balance }) => BigInt(balance) > balanceGt)
      );
      return {
        id: meta.address.toLowerCase(),
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        balances,
      };
    }),
    R.indexBy(e => e.id)
  ) as BalancesByContract;

  const isExcluded = (holder: string) => excludeHolders.includes(holder.toLowerCase());
  const hasNonZeroBalance = (e: HolderWithDetails) => e.balance !== '0' && e.balance !== 0n;

  // for any token that is not the base token, we need to convert the balance to the base token
  if (config.protocol_type === 'beefy_clm_vault') {
    // in case it's a clm vault, the base token is the manager
    // express everything in terms of the manager's share token
    const clmManager = config.beefy_clm_manager;

    const managerShareHolders = R.unique([
      ...getHoldersWithDetails(balancesByContract, clmManager.vault_address),
      ...R.flatMap(clmManager.reward_pools, pool =>
        getHoldersWithDetails(balancesByContract, pool.reward_pool_address)
      ),
      ...R.flatMap(clmManager.boosts, boost =>
        getHoldersWithDetails(balancesByContract, boost.boost_address)
      ),
    ]);

    const vaultManagerShareBalance = BigInt(
      R.pipe(
        managerShareHolders,
        R.find(b => b.holder.toLocaleLowerCase() === config.strategy_address.toLowerCase()),
        b => b?.balance ?? '0'
      )
    );

    const vaultBalances = balancesByContract[config.vault_address.toLowerCase()]?.balances ?? [];
    const vaultTotalSupply = R.reduce(vaultBalances, (acc, curr) => acc + BigInt(curr.balance), 0n);
    const vaultShareHolders = R.pipe(
      [
        ...getHoldersWithDetails(balancesByContract, config.vault_address),
        ...R.flatMap(config.reward_pools, pool =>
          getHoldersWithDetails(balancesByContract, pool.reward_pool_address)
        ),
        ...R.flatMap(config.boosts, boost =>
          getHoldersWithDetails(balancesByContract, boost.boost_address)
        ),
      ],
      R.unique(),
      R.filter(e => !isExcluded(e.holder))
    );

    const vaultManagerHolders = R.map(vaultShareHolders, e => ({
      ...e,
      balance: (BigInt(e.balance) * vaultManagerShareBalance) / vaultTotalSupply,
    }));

    const allHoldersBalances = R.pipe(
      [...managerShareHolders, ...vaultManagerHolders],
      R.filter(e => hasNonZeroBalance(e) && !isExcluded(e.holder))
    ) as HolderWithDetails[];

    return aggregateByHolder(allHoldersBalances);
  }

  const managerShareHolders = R.unique([
    ...getHoldersWithDetails(balancesByContract, config.vault_address),
    ...R.flatMap(config.reward_pools, pool =>
      getHoldersWithDetails(balancesByContract, pool.reward_pool_address)
    ),
    ...R.flatMap(config.boosts, boost =>
      getHoldersWithDetails(balancesByContract, boost.boost_address)
    ),
  ]);

  const allHoldersBalances = R.pipe(
    managerShareHolders,
    R.filter(e => e.balance !== '0' && !isExcluded(e.holder))
  ) as HolderWithDetails[];

  return aggregateByHolder(allHoldersBalances);
};

export const getVaultHolders = async (
  chainId: ChainId,
  vault_id: string,
  block: bigint,
  balanceGt = 0n
): Promise<VaultHolders> => {
  // first get the addresses linked to that vault id
  const configs = await getBeefyBreakdownableVaultConfig(chainId, vault =>
    vault.id.startsWith(vault_id)
  );

  const tokens = uniq(
    configs
      .flatMap(config =>
        config.protocol_type === 'beefy_clm_vault'
          ? [
              config.vault_address,
              config.beefy_clm_manager.vault_address,
              ...config.beefy_clm_manager.reward_pools.map(pool => pool.reward_pool_address),
              ...config.beefy_clm_manager.boosts.map(boost => boost.boost_address),
              ...config.reward_pools.map(pool => pool.reward_pool_address),
              ...config.boosts.map(boost => boost.boost_address),
            ]
          : [
              config.vault_address,
              ...config.reward_pools.map(pool => pool.reward_pool_address),
              ...config.boosts.map(boost => boost.boost_address),
            ]
      )
      .map(address => address.toLowerCase() as Hex)
  );

  const strategies = uniq(
    configs
      .flatMap(config =>
        config.protocol_type === 'beefy_clm_vault'
          ? [config.strategy_address, config.beefy_clm_manager.strategy_address]
          : [config.strategy_address]
      )
      .map(address => address.toLowerCase())
  );

  const excludeHolders = uniq([...strategies, ...tokens]);

  const { balanceMap, tokenMetadata } = await getTokenBalancesAtBlock({
    chainId,
    targetBlock: block,
    tokenAddresses: tokens as Hex[],
    excludeAccounts: excludeHolders as Hex[],
  });

  return R.pipe(
    tokenMetadata,
    R.map(meta => {
      if (!meta.symbol) throw new FriendlyError(`Token ${meta.id} has no symbol`);
      if (!meta.name) throw new FriendlyError(`Token ${meta.id} has no name`);
      const byAccount = balanceMap.get(meta.id.toLowerCase()) ?? new Map<string, Decimal>();
      const balances = Array.from(byAccount.entries(), ([holder, decimal]) => ({
        balance: decimal.toString(),
        holder,
      })).filter(({ balance }) => BigInt(balance) > balanceGt);
      return {
        id: meta.address.toLowerCase(),
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        balances,
      };
    })
  );
};
