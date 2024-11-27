import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import type { Hex } from 'viem';
import { type ChainId, chainIdSchema } from '../../config/chains';
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
          `contract:${chain}:${input_contract_address}:${block_number}:holders`,
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
          fetchPage: ({ skip, first }) =>
            sdk.VaultSharesBalances({
              skip,
              first,
              block: Number(block),
              account_not_in: ['0x0000000000000000000000000000000000000000'], // empty list returns nothing
              token_in_1: [contract_address],
              token_in_2: [contract_address],
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
