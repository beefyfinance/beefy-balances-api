import { type Static, Type } from '@sinclair/typebox';
import Decimal from 'decimal.js';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import * as R from 'remeda';
import type { Hex } from 'viem';
import { type ChainId, chainIdSchema } from '../../config/chains';
import { Order_By } from '../../queries/codegen/sdk';
import { addressSchema } from '../../schema/address';
import { bigintSchema } from '../../schema/bigint';
import { getAsyncCache } from '../../utils/async-lock';
import { decimalToBigInt } from '../../utils/decimal';
import { FriendlyError } from '../../utils/error';
import { getGlobalSdk, paginate } from '../../utils/sdk';
import { getAccountId, getTokenId } from '../../utils/subgraph-ids';
import { getTokenBalancesAtBlock } from '../../utils/token-balance-at-block';

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
  const excludeAccounts = ['0x0000000000000000000000000000000000000000'] as Hex[];
  const { balances, tokenMetadata } = await getTokenBalancesAtBlock({
    chainId,
    targetBlock: block,
    tokenAddresses: [contract_address],
    excludeAccounts,
  });

  if (tokenMetadata.length === 0) return [];

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
          R.filter(e => e.balanceRaw > 0n),
          R.map(e => ({
            balance: e.balanceRaw.toString(),
            holder: e.accountAddress,
          }))
        ),
      };
    })
  );
};

const getTopContractHolders = async (
  chainId: ChainId,
  contract_addresses: Hex[],
  limit: number
) => {
  const tokenIn = contract_addresses.map(a => getTokenId({ chainId, address: a }));
  const accountNotIn = [
    getAccountId({ chainId, address: '0x0000000000000000000000000000000000000000' as Hex }),
  ];
  const sdk = getGlobalSdk();
  const merged = await paginate({
    fetchPage: ({ offset, limit: pageSize }) =>
      sdk.ContractBalance({
        token_in: tokenIn,
        account_not_in: accountNotIn,
        tokenOffset: offset,
        tokenLimit: pageSize,
        offset: 0,
        limit,
        orderBy: { amount: Order_By.Desc },
      }),
    count: res => res.data.Token.length,
    merge: (a, b) => ({
      ...a,
      data: {
        ...a.data,
        Token: [...(a.data?.Token ?? []), ...(b.data?.Token ?? [])],
      },
    }),
  });

  return R.pipe(
    merged.data?.Token ?? [],
    R.map(token => {
      if (!token.symbol) throw new FriendlyError(`Token ${token.id} has no symbol`);
      if (!token.name) throw new FriendlyError(`Token ${token.id} has no name`);
      return {
        id: token.address.toLowerCase(),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        balances: token.balances.map(balance => {
          const amount = new Decimal(balance.amount);
          const rawAmount = decimalToBigInt(amount, token.decimals);
          return {
            balance: balance.amount,
            rawAmount: rawAmount.toString(),
            holder: balance.account_id,
          };
        }),
      };
    })
  );
};
