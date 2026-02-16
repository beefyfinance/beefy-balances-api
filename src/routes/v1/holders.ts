import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import * as R from 'remeda';
import { chainIdSchema } from '../../config/chains';
import type { AccountLatestBalanceQuery, AllTokenHoldersQuery } from '../../queries/codegen/sdk';
import { addressSchema } from '../../schema/address';
import { getAsyncCache } from '../../utils/async-lock';
import { interpretAsDecimal } from '../../utils/decimal';
import { getGlobalSdk, paginate } from '../../utils/sdk';
import { getChainIdFromNetworkId } from '../../utils/viemClient';

// Types
const holderCountSchema = Type.Object({
  chain: chainIdSchema,
  token_address: addressSchema,
  holder_count: Type.Number(),
});
type HolderCount = Static<typeof holderCountSchema>;

const tokenSchema = Type.Object({
  address: addressSchema,
  symbol: Type.String(),
  name: Type.String(),
  decimals: Type.Number(),
});

const balanceSchema = Type.Object({
  token: tokenSchema,
  amount: Type.String(),
  rawAmount: Type.String(),
});

const blockSchema = Type.Object({
  number: Type.Number(),
  timestamp: Type.Number(),
});

const chainDataSchema = Type.Object({
  chain: chainIdSchema,
  block: blockSchema,
  balances: Type.Array(balanceSchema),
});

type ChainData = Static<typeof chainDataSchema>;

type AllTokenHoldersResponse = { data: AllTokenHoldersQuery };

// Business Logic
const getHolderCount = async (): Promise<Array<HolderCount>> => {
  const sdk = getGlobalSdk();
  const merged = await paginate<AllTokenHoldersResponse>({
    fetchPage: ({ offset, limit }) => sdk.AllTokenHolders({ offset, limit }),
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
    R.map((token: { id: string; chainId: number; holderCount: number }) => ({
      chain: getChainIdFromNetworkId(token.chainId),
      token_address: token.id,
      holder_count: Number(token.holderCount),
    }))
  );
};

type AccountLatestBalanceResponse = { data: AccountLatestBalanceQuery };

const getLatestBalances = async (address: string): Promise<ChainData[]> => {
  const sdk = getGlobalSdk();
  const merged = await paginate<AccountLatestBalanceResponse>({
    fetchPage: ({ offset, limit }) =>
      sdk.AccountLatestBalance({
        address,
        offset,
        limit,
      }),
    count: res => res.data.Account_by_pk?.balances.length ?? 0,
    merge: (a, b) => ({
      ...a,
      data: {
        ...a.data,
        Account_by_pk: a.data.Account_by_pk
          ? {
              ...a.data.Account_by_pk,
              balances: [
                ...(a.data.Account_by_pk.balances ?? []),
                ...(b.data?.Account_by_pk?.balances ?? []),
              ],
            }
          : b.data?.Account_by_pk
            ? { ...b.data.Account_by_pk, balances: b.data.Account_by_pk.balances ?? [] }
            : null,
        _meta: a.data._meta ?? b.data?._meta,
      },
    }),
  });

  if (!merged.data?.Account_by_pk) return [];

  const account = merged.data.Account_by_pk;
  const meta = merged.data._meta?.[0];
  const block = {
    number: meta?.progressBlock ?? 0,
    timestamp: 0,
  };

  const balancesWithChain = (account.balances ?? [])
    .filter(
      (balance): balance is typeof balance & { token: NonNullable<typeof balance.token> } =>
        balance.token != null
    )
    .map(balance => {
      const decimals = Number(balance.token.decimals);
      const amount = interpretAsDecimal(balance.amount, decimals).toString();
      return {
        chainId: balance.chainId,
        token: {
          address: balance.token.id,
          symbol: balance.token.symbol ?? '',
          name: balance.token.name ?? '',
          decimals,
        },
        amount,
        rawAmount: balance.amount,
      };
    });

  const byChain = R.groupBy(balancesWithChain, b => String(b.chainId));

  return R.pipe(
    Object.entries(byChain),
    R.map(([numericChainId, chainBalances]) => ({
      chain: getChainIdFromNetworkId(Number(numericChainId)),
      block,
      balances: chainBalances.map(({ token, amount, rawAmount }) => ({
        token,
        amount,
        rawAmount,
      })),
    })),
    R.filter(chainData => chainData.balances.length > 0)
  );
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
          chains: Type.Array(chainDataSchema),
        }),
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:address/latest-balances',
      { schema },
      async (request, reply) => {
        const { address } = request.params;

        const result = await asyncCache.wrap(
          `latest-balances:${address.toLowerCase()}`,
          60 * 1000,
          async () => await getLatestBalances(address)
        );
        reply.send({ chains: result });
      }
    );
  }

  done();
}
