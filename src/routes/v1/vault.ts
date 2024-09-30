import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { uniq } from 'lodash';
import type { Hex } from 'viem';
import { type ChainId, chainIdSchema } from '../../config/chains';
import { addressSchema } from '../../schema/address';
import { bigintSchema } from '../../schema/bigint';
import { getAsyncCache } from '../../utils/async-lock';
import { getSdksForChain, paginate } from '../../utils/sdk';
//import { getAllSdks, paginate } from '../../utils/sdk';
import { getBeefyVaultConfig } from '../../vault-breakdown/vault/getBeefyVaultConfig';

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
  const configs = await getBeefyVaultConfig(chainId, vault => vault.id.startsWith(vault_id));

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
