import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { min } from 'lodash';
import type { Hex } from 'viem';
import { type ChainId, chainIdSchema } from '../../config/chains';
import { OrderDirection, TokenBalance_OrderBy } from '../../queries/codegen/sdk';
import { addressSchema } from '../../schema/address';
import { bigintSchema } from '../../schema/bigint';
import { getAsyncCache } from '../../utils/async-lock';
import { FriendlyError } from '../../utils/error';
import { getSdksForChain, paginate } from '../../utils/sdk';

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
      contract_address: addressSchema,
      block_number: bigintSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const schema: FastifySchema = {
      tags: ['contract'],
      params: urlParamsSchema,
      response: {
        200: contractHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:chain/:contract_address/:block_number/share-tokens-balances',
      { schema },
      async (request, reply) => {
        const { chain, contract_address: input_contract_address, block_number } = request.params;
        const result = await asyncCache.wrap(
          `contract:${chain}:${input_contract_address.toLowerCase()}:${block_number}:holders`,
          5 * 60 * 1000,
          async () => {
            const results = await getContractHolders(
              chain,
              input_contract_address as Hex,
              BigInt(block_number)
            );
            if (results.length === 0) {
              throw new FriendlyError(
                `No contract balances found for contract ${input_contract_address}`
              );
            }
            if (results.length > 1) {
              throw new FriendlyError(
                `Multiple contract balances found for contract ${input_contract_address}. Dev must fix.`
              );
            }
            return results[0];
          }
        );
        reply.send(result);
      }
    );
  }

  // all holder count list for all chains
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const querySchema = Type.Object({
      contract_addresses: Type.Array(addressSchema, { minItems: 1, maxItems: 100 }),
      limit: Type.Number({ default: 100, minimum: 1, maximum: 1000 }),
    });
    type QueryParams = Static<typeof querySchema>;

    const schema: FastifySchema = {
      tags: ['contract'],
      params: urlParamsSchema,
      querystring: querySchema,
      response: {
        200: contractHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams; Querystring: QueryParams }>(
      '/:chain/top-holders',
      { schema },
      async (request, reply) => {
        const { chain } = request.params;
        const { contract_addresses, limit } = request.query;

        if (
          !contract_addresses ||
          !Array.isArray(contract_addresses) ||
          contract_addresses.length === 0
        ) {
          throw new FriendlyError('contract_addresses is required');
        }

        const result = await asyncCache.wrap(
          `vault:${chain}:${contract_addresses.join(',').toLowerCase()}:top-holders:${limit}`,
          5 * 60 * 1000,
          async () => await getTopContractHolders(chain, contract_addresses as Hex[], limit)
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

const contractHoldersSchema = Type.Array(tokenBalancesSchema);
type ContractHolders = Static<typeof contractHoldersSchema>;

const getContractHolders = async (
  chainId: ChainId,
  contract_address: Hex,
  block: bigint
): Promise<ContractHolders> => {
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
                  account_not_in: ['0x0000000000000000000000000000000000000000'], // empty list returns nothing
                  amount_gt: '0',
                  token_in_1: [contract_address],
                  token_in_2: [contract_address],
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

const getTopContractHolders = async (
  chainId: ChainId,
  contract_addresses: Hex[],
  limit: number
) => {
  const res = (
    await Promise.all(
      getSdksForChain(chainId).map(sdk =>
        paginate({
          fetchPage: ({ skip: tokenSkip, first: tokenFirst }) =>
            sdk.ContractBalance({
              tokenSkip,
              tokenFirst,
              skip: 0,
              first: limit,
              account_not_in: ['0x0000000000000000000000000000000000000000'], // providing an empty account_not_in will return 0 holders
              token_in_1: contract_addresses,
              token_in_2: contract_addresses,
              orderBy: TokenBalance_OrderBy.Amount,
              orderDirection: OrderDirection.Desc,
            }),
          count: res => res.data.tokens.length,
        })
      )
    )
  ).flat();

  return res.flatMap(chainRes =>
    chainRes.data.tokens.map(token => {
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
          rawAmount: balance.rawAmount,
          holder: balance.account.id,
        })),
      };
    })
  );
};
