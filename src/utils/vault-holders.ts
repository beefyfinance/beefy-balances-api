import { type Static, Type } from '@sinclair/typebox';
import { groupBy, keyBy, min, uniq } from 'lodash';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { addressSchema } from '../schema/address';
import {
  type BeefyVault,
  getBeefyBreakdownableVaultConfig,
} from '../vault-breakdown/vault/getBeefyVaultConfig';
import { FriendlyError } from './error';
import { getSdksForChain, paginate } from './sdk';

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

export const getVaultHoldersAsBaseVaultEquivalentForVaultAddress = async (
  chainId: ChainId,
  vault_address: Hex,
  block: bigint
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

  return _getVaultHoldersAsBaseVaultEquivalent(chainId, configs[0], block);
};

export const getVaultHoldersAsBaseVaultEquivalentForStrategyAddress = async (
  chainId: ChainId,
  strategy_address: Hex,
  block: bigint
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

  return _getVaultHoldersAsBaseVaultEquivalent(chainId, configs[0], block);
};

export const getVaultHoldersAsBaseVaultEquivalentForVaultId = async (
  chainId: ChainId,
  vault_id: string,
  block: bigint
) => {
  // first get the addresses linked to that vault id
  const configs = await getBeefyBreakdownableVaultConfig(chainId, vault => vault.id === vault_id);
  if (!configs.length) {
    throw new FriendlyError(`Vault with "id" ${vault_id} not found`);
  }
  if (configs.length > 1) {
    throw new FriendlyError(`Vault with "id" ${vault_id} is not unique`);
  }

  return _getVaultHoldersAsBaseVaultEquivalent(chainId, configs[0], block);
};

const _getVaultHoldersAsBaseVaultEquivalent = async (
  chainId: ChainId,
  config: BeefyVault,
  block: bigint
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

  const res = (
    await Promise.all(
      getSdksForChain(chainId).map(sdk =>
        paginate({
          fetchPage: ({ skip: tokenSkip, first: tokenFirst }) =>
            paginate({
              fetchPage: ({ skip, first }) =>
                sdk.TokenBalance({
                  tokenSkip,
                  tokenFirst,
                  skip,
                  first,
                  block: Number(block),
                  account_not_in: ['0x0000000000000000000000000000000000000000'],
                  token_in_1: tokens,
                  token_in_2: tokens,
                }),
              count: res => min(res.data.tokens.map(token => token.balances.length)) ?? 0,
            }),
          count: res => min(res.map(chainRes => chainRes.data.tokens.length)) ?? 0,
        })
      )
    )
  ).flat();

  const balancesByContract = keyBy(
    res.flatMap(chainRes =>
      chainRes.flatMap(tokenPage =>
        tokenPage.data.tokens.map(token => {
          if (!token.symbol) {
            throw new FriendlyError(`Token ${token.id} has no symbol`);
          }
          if (!token.decimals) {
            throw new FriendlyError(`Token ${token.id} has no decimals`);
          }
          if (!token.name) {
            throw new FriendlyError(`Token ${token.id} has no name`);
          }

          return {
            id: token.id.toLowerCase(),
            name: token.name,
            symbol: token.symbol,
            decimals: Number.parseInt(token.decimals, 10),
            balances: token.balances.map(balance => ({
              balance: balance.amount,
              holder: balance.account.id,
            })),
          };
        })
      )
    ),
    e => e.id
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
      e => e.balance !== '0' && !excludeHolders.includes(e.holder.toLowerCase())
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
    e => e.balance !== '0' && !excludeHolders.includes(e.holder.toLowerCase())
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
  block: bigint
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

  const res = (
    await Promise.all(
      getSdksForChain(chainId).map(sdk =>
        paginate({
          fetchPage: ({ skip: tokenSkip, first: tokenFirst }) =>
            paginate({
              fetchPage: ({ skip, first }) =>
                sdk.TokenBalance({
                  tokenSkip,
                  tokenFirst,
                  skip,
                  first,
                  block: Number(block),
                  account_not_in: excludeHolders,
                  token_in_1: tokens,
                  token_in_2: tokens,
                }),
              count: res => min(res.data.tokens.map(token => token.balances.length)) ?? 0,
            }),
          count: res => min(res.map(chainRes => chainRes.data.tokens.length)) ?? 0,
        })
      )
    )
  ).flat();

  return res.flatMap(chainRes =>
    chainRes.flatMap(tokenPage =>
      tokenPage.data.tokens.map(token => {
        if (!token.symbol) {
          throw new FriendlyError(`Token ${token.id} has no symbol`);
        }
        if (!token.decimals) {
          throw new FriendlyError(`Token ${token.id} has no decimals`);
        }
        if (!token.name) {
          throw new FriendlyError(`Token ${token.id} has no name`);
        }

        return {
          id: token.id,
          name: token.name,
          symbol: token.symbol,
          decimals: Number.parseInt(token.decimals, 10),
          balances: token.balances.map(balance => ({
            balance: balance.amount,
            holder: balance.account.id,
          })),
        };
      })
    )
  );
};
