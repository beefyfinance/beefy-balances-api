import { type Static, Type } from '@sinclair/typebox';
import { Decimal } from 'decimal.js';
import { groupBy, uniq } from 'lodash';
import * as R from 'remeda';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { addressSchema } from '../schema/address';
import {
  type BeefyVault,
  getBeefyBreakdownableVaultConfig,
} from '../vault-breakdown/vault/getBeefyVaultConfig';
import { decimalToBigInt } from './decimal';
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

const _getVaultHoldersAsBaseVaultEquivalent = async (
  chainId: ChainId,
  config: BeefyVault,
  block: bigint,
  balanceGt = 0n
) => {
  const tokens = uniq(
    (config.protocol_type === 'beefy_clm_vault'
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
    ).map(address => address.toLowerCase() as Hex)
  );

  const strategies = uniq(
    (config.protocol_type === 'beefy_clm_vault'
      ? [config.strategy_address, config.beefy_clm_manager.strategy_address]
      : [config.strategy_address]
    ).map(address => address.toLowerCase())
  );
  const excludeHolders = uniq([...strategies, ...tokens]);

  const { balances: rawBalances, tokenMetadata } = await getTokenBalancesAtBlock({
    chainId,
    targetBlock: block,
    tokenAddresses: tokens as Hex[],
    excludeAccounts: ['0x0000000000000000000000000000000000000000'],
  });

  const balancesByContract = R.pipe(
    tokenMetadata,
    R.map(meta => {
      if (!meta.symbol) throw new FriendlyError(`Token ${meta.id} has no symbol`);
      if (!meta.name) throw new FriendlyError(`Token ${meta.id} has no name`);
      return {
        tokenAddress: meta.address.toLowerCase(),
        balances: R.pipe(
          rawBalances,
          R.filter(e => e.tokenAddress === meta.address.toLowerCase()),
          R.filter(e => e.balanceRaw > balanceGt),
          R.map(e => ({
            balance: e.balanceRaw,
            // balanceDecimal: e.balanceDecimal,
            holder: e.accountAddress,
          }))
        ),
      };
    }),
    R.indexBy(e => e.tokenAddress.toLowerCase())
  );

  // for any token that is not the base token, we need to convert the balance to the base token
  if (config.protocol_type === 'beefy_clm_vault') {
    // in case it's a clm vault, the base token is the manager
    // express everything in terms of the manager's share token
    const clmManager = config.beefy_clm_manager;

    const managerShareHolders = uniq([
      ...(balancesByContract[clmManager.vault_address.toLowerCase()]?.balances ?? []).map(e => ({
        ...e,
        hold_details: [
          {
            token: clmManager.vault_address,
            balance: e.balance,
          },
        ],
      })),
      ...clmManager.reward_pools.flatMap(pool =>
        (balancesByContract[pool.reward_pool_address.toLowerCase()]?.balances ?? []).map(e => ({
          ...e,
          hold_details: [
            {
              token: pool.reward_pool_address,
              balance: e.balance,
            },
          ],
        }))
      ),
      ...clmManager.boosts.flatMap(boost =>
        (balancesByContract[boost.boost_address.toLowerCase()]?.balances ?? []).map(e => ({
          ...e,
          hold_details: [
            {
              token: boost.boost_address,
              balance: e.balance,
            },
          ],
        }))
      ),
    ]);

    // now we need to find out the actual vault balance in terms of the manager's share token
    const vaultManagerShareBalance = BigInt(
      managerShareHolders.find(
        balance => balance.holder.toLocaleLowerCase() === config.strategy_address.toLowerCase()
      )?.balance ?? '0'
    );

    // we split that balance among all the holders of vault and vault reward pools
    const vaultBalances = balancesByContract[config.vault_address.toLowerCase()]?.balances ?? [];
    const vaultTotalSupply = vaultBalances.reduce((acc, curr) => acc + BigInt(curr.balance), 0n);
    const vaultShareHolders = uniq([
      // vault holders
      ...vaultBalances.map(e => ({
        ...e,
        hold_details: [
          {
            token: config.vault_address,
            balance: e.balance,
          },
        ],
      })),
      // vault reward pool holders
      ...config.reward_pools.flatMap(pool =>
        (balancesByContract[pool.reward_pool_address.toLowerCase()]?.balances ?? []).map(e => ({
          ...e,
          hold_details: [
            {
              token: pool.reward_pool_address,
              balance: e.balance,
            },
          ],
        }))
      ),
      // vault boost holders
      ...config.boosts.flatMap(boost =>
        (balancesByContract[boost.boost_address.toLowerCase()]?.balances ?? []).map(e => ({
          ...e,
          hold_details: [
            {
              token: boost.boost_address,
              balance: e.balance,
            },
          ],
        }))
      ),
    ]).filter(e => !excludeHolders.includes(e.holder.toLowerCase()));

    const vaultManagerHolders = vaultShareHolders.map(e => {
      return {
        ...e,
        balance: (BigInt(e.balance) * vaultManagerShareBalance) / vaultTotalSupply,
      };
    });

    const allHoldersBalances = [...managerShareHolders, ...vaultManagerHolders].filter(
      e => e.balance !== 0n && !excludeHolders.includes(e.holder.toLowerCase())
    );

    // now merge the multiple holds into a single hold per holder
    const balancesPerHolder = groupBy(allHoldersBalances, e => e.holder.toLowerCase());
    const mergedHolders = Object.entries(balancesPerHolder).map(([holder, balances]) => ({
      holder,
      balance: balances.reduce((acc, curr) => acc + BigInt(curr.balance), 0n),
      hold_details: balances.flatMap(e => e.hold_details),
    }));
    return mergedHolders;
  }

  // now we need to find out the actual vault balance in terms of the manager's share token
  const managerShareHolders = uniq([
    ...(balancesByContract[config.vault_address.toLowerCase()]?.balances ?? []).map(e => ({
      ...e,
      hold_details: [
        {
          token: config.vault_address,
          balance: e.balance,
        },
      ],
    })),
    ...config.reward_pools.flatMap(pool =>
      (balancesByContract[pool.reward_pool_address.toLowerCase()]?.balances ?? []).map(e => ({
        ...e,
        hold_details: [
          {
            token: pool.reward_pool_address,
            balance: e.balance,
          },
        ],
      }))
    ),
    ...config.boosts.flatMap(boost =>
      (balancesByContract[boost.boost_address.toLowerCase()]?.balances ?? []).map(e => ({
        ...e,
        hold_details: [
          {
            token: boost.boost_address,
            balance: e.balance,
          },
        ],
      }))
    ),
  ]);

  const allHoldersBalances = managerShareHolders.filter(
    e => e.balance !== 0n && !excludeHolders.includes(e.holder.toLowerCase())
  );

  // now merge the multiple holds into a single hold per holder
  const balancesPerHolder = groupBy(allHoldersBalances, e => e.holder.toLowerCase());
  const mergedHolders = Object.entries(balancesPerHolder).map(([holder, balances]) => ({
    holder,
    balance: balances.reduce((acc, curr) => acc + BigInt(curr.balance), 0n),
    hold_details: balances.flatMap(e => e.hold_details),
  }));
  return mergedHolders;
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

  const { balances, tokenMetadata } = await getTokenBalancesAtBlock({
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
      return {
        id: meta.address.toLowerCase(),
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        balances: R.pipe(
          balances,
          R.filter(e => e.tokenAddress === meta.address.toLowerCase()),
          R.filter(e => e.balanceRaw > balanceGt),
          R.map(e => ({
            balance: e.balanceRaw.toString(),
            holder: e.accountAddress,
          }))
        ),
      };
    })
  );
};
