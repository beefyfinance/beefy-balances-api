import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { keyBy, uniq } from 'lodash';
import type { Hex } from 'viem';
import { type ChainId, chainIdSchema } from '../../config/chains';
import { TokenBalance } from '../../queries/codegen/sdk';
import { addressSchema } from '../../schema/address';
import { bigintSchema } from '../../schema/bigint';
import { getAsyncCache } from '../../utils/async-lock';
import { getSdksForChain, paginate } from '../../utils/sdk';
import {
  getBeefyBreakdownableVaultConfig,
  getBeefyVaultConfig,
} from '../../vault-breakdown/vault/getBeefyVaultConfig';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  const asyncCache = getAsyncCache();

  // all holder count list for all chains
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
      vault_id: Type.String({ description: 'The vault id or clm manager id or reward pool id' }),
      block_number: bigintSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      response: {
        200: vaultHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:chain/:vault_id/:block_number/share-tokens-balances',
      { schema },
      async (request, reply) => {
        const { chain, vault_id: input_vault_id, block_number } = request.params;
        const vault_id = input_vault_id.replace(/-(rp|vault)$/, '');

        if (vault_id !== input_vault_id) {
          reply.code(301);
          reply.redirect(
            `/api/v1/vault/${chain}/${vault_id}/${block_number}/share-tokens-balances`
          );
          return;
        }

        const result = await asyncCache.wrap(
          `vault:${chain}:${vault_id}:${block_number}:holders`,
          5 * 60 * 1000,
          async () => await getVaultHolders(chain, vault_id, BigInt(block_number))
        );
        reply.send(result);
      }
    );
  }

  // all holder count list for all chains
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
      vault_id: Type.String({ description: 'The vault id or clm manager id or reward pool id' }),
      block_number: bigintSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      response: {
        200: vaultHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:chain/:vault_id/:block_number/bundle-holder-share',
      { schema },
      async (request, reply) => {
        const { chain, vault_id: input_vault_id, block_number } = request.params;
        const base_vault_id = input_vault_id.replace(/-(rp)$/, '');

        if (base_vault_id !== input_vault_id) {
          reply.code(301);
          reply.redirect(
            `/api/v1/vault/${chain}/${base_vault_id}/${block_number}/bundle-holder-share`
          );
          return;
        }

        const result = await asyncCache.wrap(
          `vault:${chain}:${base_vault_id}:${block_number}:holders`,
          5 * 60 * 1000,
          async () =>
            getVaultHoldersAsBaseVaultEquivalent(chain, base_vault_id, BigInt(block_number))
        );

        reply.send(result);
      }
    );
  }

  done();
}

const tokenBalancesSchema = Type.Object({
  id: addressSchema,
  name: Type.String(),
  symbol: Type.String(),
  decimals: Type.Number(),
  balances: Type.Array(Type.Object({ balance: Type.String(), holder: addressSchema })),
});

const vaultHoldersSchema = Type.Array(tokenBalancesSchema);
type VaultHolders = Static<typeof vaultHoldersSchema>;

const getVaultHolders = async (
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
          fetchPage: ({ skip, first }) =>
            sdk.VaultSharesBalances({
              skip,
              first,
              block: Number(block),
              account_not_in: excludeHolders,
              token_in_1: tokens,
              token_in_2: tokens,
            }),
          count: res => res.data.tokenBalances.length,
        })
      )
    )
  ).flat();

  return res.flatMap(chainRes => {
    const tokens = chainRes.data.tokens;
    const balances = chainRes.data.tokenBalances;

    return tokens.map(token => {
      const tokenBalances = balances.filter(balance => balance.token.id === token.id);

      if (!token.symbol) {
        throw new Error(`Token ${token.id} has no symbol`);
      }
      if (!token.decimals) {
        throw new Error(`Token ${token.id} has no decimals`);
      }
      if (!token.name) {
        throw new Error(`Token ${token.id} has no name`);
      }

      return {
        id: token.id,
        name: token.name,
        symbol: token.symbol,
        decimals: Number.parseInt(token.decimals, 10),
        balances: tokenBalances.map(balance => ({
          balance: balance.amount,
          holder: balance.account.id,
        })),
      };
    });
  });
};

const getVaultHoldersAsBaseVaultEquivalent = async (
  chainId: ChainId,
  vault_id: string,
  block: bigint
) => {
  // first get the addresses linked to that vault id
  const configs = await getBeefyBreakdownableVaultConfig(chainId, vault => vault.id === vault_id);
  if (!configs.length) {
    throw new Error(`Vault ${vault_id} not found`);
  }
  if (configs.length > 1) {
    throw new Error(`Vault ${vault_id} is not unique`);
  }

  const config = configs[0];

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
          fetchPage: ({ skip, first }) =>
            sdk.VaultSharesBalances({
              skip,
              first,
              block: Number(block),
              account_not_in: ['0x0000000000000000000000000000000000000000'],
              token_in_1: tokens,
              token_in_2: tokens,
            }),
          count: res => res.data.tokenBalances.length,
        })
      )
    )
  ).flat();

  const balancesByContract = keyBy(
    res.flatMap(chainRes => {
      const tokens = chainRes.data.tokens;
      const balances = chainRes.data.tokenBalances;

      return tokens.map(token => {
        const tokenBalances = balances.filter(balance => balance.token.id === token.id);

        if (!token.symbol) {
          throw new Error(`Token ${token.id} has no symbol`);
        }
        if (!token.decimals) {
          throw new Error(`Token ${token.id} has no decimals`);
        }
        if (!token.name) {
          throw new Error(`Token ${token.id} has no name`);
        }

        return {
          id: token.id.toLowerCase(),
          name: token.name,
          symbol: token.symbol,
          decimals: Number.parseInt(token.decimals, 10),
          balances: tokenBalances.map(balance => ({
            balance: balance.amount,
            holder: balance.account.id,
          })),
        };
      });
    }),
    e => e.id
  );

  // for any token that is not the base token, we need to convert the balance to the base token
  if (config.protocol_type === 'beefy_clm_vault') {
    // in case it's a clm vault, the base token is the manager
    // express everything in terms of the manager's share token
    const clmManager = config.beefy_clm_manager;

    const managerShareHolders = uniq([
      ...(balancesByContract[clmManager.vault_address.toLowerCase()]?.balances ?? []),
      ...clmManager.reward_pools.flatMap(
        pool => balancesByContract[pool.reward_pool_address.toLowerCase()]?.balances ?? []
      ),
      ...clmManager.boosts.flatMap(
        boost => balancesByContract[boost.boost_address.toLowerCase()]?.balances ?? []
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
      ...vaultBalances,
      // vault reward pool holders
      ...config.reward_pools.flatMap(
        pool => balancesByContract[pool.reward_pool_address.toLowerCase()]?.balances ?? []
      ),
      // vault boost holders
      ...config.boosts.flatMap(
        boost => balancesByContract[boost.boost_address.toLowerCase()]?.balances ?? []
      ),
    ]).filter(e => !excludeHolders.includes(e.holder.toLowerCase()));

    const vaultManagerHolders = vaultShareHolders.map(e => {
      console.log({
        e,
        vaultManagerShareBalance,
        vaultTotalSupply,
        res0: BigInt(e.balance) * vaultManagerShareBalance,
        res1: (BigInt(e.balance) * vaultManagerShareBalance) / vaultTotalSupply,
      });
      return {
        ...e,
        balance: (BigInt(e.balance) * vaultManagerShareBalance) / vaultTotalSupply,
      };
    });

    return [...managerShareHolders, ...vaultManagerHolders].filter(
      e => e.balance !== '0' && !excludeHolders.includes(e.holder.toLowerCase())
    );
  }

  // now we need to find out the actual vault balance in terms of the manager's share token
  const managerShareHolders = uniq([
    ...(balancesByContract[config.vault_address.toLowerCase()]?.balances ?? []),
    ...config.reward_pools.flatMap(
      pool => balancesByContract[pool.reward_pool_address.toLowerCase()]?.balances ?? []
    ),
    ...config.boosts.flatMap(
      boost => balancesByContract[boost.boost_address.toLowerCase()]?.balances ?? []
    ),
  ]);

  return managerShareHolders.filter(
    e => e.balance !== '0' && !excludeHolders.includes(e.holder.toLowerCase())
  );
};
