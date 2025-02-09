import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { chainIdSchema } from '../../config/chains';
import { addressSchema } from '../../schema/address';
import { getAsyncCache } from '../../utils/async-lock';
import { interpretAsDecimal } from '../../utils/decimal';
import { getAllSdks, paginate } from '../../utils/sdk';

// Types
const holderCountSchema = Type.Object({
  chain: chainIdSchema,
  token_address: addressSchema,
  holder_count: Type.Number(),
});
type HolderCount = Static<typeof holderCountSchema>;

const balanceSchema = Type.Object({
  chain: chainIdSchema,
  token: Type.Object({
    address: addressSchema,
    symbol: Type.String(),
    name: Type.String(),
    decimals: Type.Number(),
  }),
  amount: Type.String(),
  rawAmount: Type.String(),
  block: Type.Object({
    number: Type.Number(),
    timestamp: Type.Number(),
  }),
});
type Balance = Static<typeof balanceSchema>;

// Business Logic
const getHolderCount = async (): Promise<Array<HolderCount>> => {
  const res = (
    await Promise.all(
      getAllSdks().map(sdk =>
        paginate({
          fetchPage: ({ skip, first }) =>
            sdk.AllTokenHolders({
              skip,
              first,
            }),
          count: res => res.data.tokenStatistics.length,
        })
      )
    )
  ).flat();

  return res.flatMap(chainRes =>
    chainRes.data.tokenStatistics.map(stat => ({
      chain: chainRes.chain,
      token_address: stat.id,
      holder_count: Number.parseInt(stat.holderCount, 10),
    }))
  );
};

const getLatestBalances = async (address: string): Promise<{ balances: Balance[] }> => {
  const res = (
    await Promise.all(
      getAllSdks().map(sdk =>
        paginate({
          fetchPage: ({ skip: pageSkip, first: pageFirst }) =>
            sdk.AccountLatestBalance({
              address,
              skip: pageSkip,
              first: pageFirst,
            }),
          count: res => res.data.account?.balances.length ?? 0,
        })
      )
    )
  ).flat();

  const balances = res.flatMap(chainRes => {
    if (!chainRes.data.account) return [];

    return chainRes.data.account.balances.map(balance => {
      const decimals = Number.parseInt(balance.token.decimals);
      const amount = interpretAsDecimal(balance.rawAmount, decimals).toString();

      return {
        chain: chainRes.chain,
        token: {
          address: balance.token.id,
          symbol: balance.token.symbol ?? '',
          name: balance.token.name ?? '',
          decimals,
        },
        amount,
        rawAmount: balance.rawAmount,
        block: {
          number: chainRes.data?._meta?.block?.number ?? 0,
          timestamp: chainRes.data?._meta?.block?.timestamp ?? 0,
        },
      };
    });
  });

  return { balances };
};

// Route Handler
export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  const asyncCache = getAsyncCache();

  // all holder count list for all chains
  {
    const schema: FastifySchema = {
      tags: ['hodlers'],
      response: {
        200: Type.Array(holderCountSchema),
      },
    };

    instance.get('/counts/all', { schema }, async (_request, reply) => {
      const result = await asyncCache.wrap(
        'holder-count:all',
        5 * 60 * 1000,
        async () => await getHolderCount()
      );
      reply.send(result);
    });
  }

  // Get latest balances for an account across all chains
  {
    const urlParamsSchema = Type.Object({
      address: addressSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const schema: FastifySchema = {
      tags: ['holders'],
      params: urlParamsSchema,
      response: {
        200: Type.Object({
          balances: Type.Array(balanceSchema),
        }),
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:address/latest-balances',
      { schema },
      async (request, reply) => {
        const { address } = request.params;

        const result = await asyncCache.wrap(
          `latest-balances:${address}`,
          60 * 1000,
          async () => await getLatestBalances(address)
        );
        reply.send(result);
      }
    );
  }

  done();
}
