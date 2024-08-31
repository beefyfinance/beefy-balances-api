import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { chainIdSchema } from '../../config/chains';
import { addressSchema } from '../../schema/address';
import { getAsyncCache } from '../../utils/async-lock';
import { getAllSdks, paginate } from '../../utils/sdk';

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

  done();
}

const holderCountSchema = Type.Object({
  chain: chainIdSchema,
  token_address: addressSchema,
  holder_count: Type.Number(),
});
type HolderCount = Static<typeof holderCountSchema>;

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
