import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { chainIdAsKeySchema } from '../../config/chains';
import { timestampNumberSchema } from '../../schema/bigint';
import { getAsyncCache } from '../../utils/async-lock';
import { getGlobalSdk } from '../../utils/sdk';
import { getChainIdFromNetworkId } from '../../utils/viemClient';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  const asyncCache = getAsyncCache();

  // status endpoint
  {
    const schema: FastifySchema = {
      tags: ['status'],
      response: {
        200: statusSchema,
      },
    };

    instance.get('', { schema }, async (_, reply) => {
      const res = await asyncCache.wrap('status', 60 * 1000, async () => {
        return await getStatus();
      });
      reply.send(res);
    });
  }

  done();
}

const endpointStatusSchema = Type.Object({
  subgraph: Type.String(),
  tag: Type.String(),
  blockNumber: Type.Union([Type.Number(), Type.Null()]),
  timestamp: Type.Union([timestampNumberSchema, Type.Null()]),
  hasErrors: Type.Boolean(),
});

const statusSchema = Type.Record(chainIdAsKeySchema, Type.Array(endpointStatusSchema));
type Status = Static<typeof statusSchema>;

async function getStatus(): Promise<Status> {
  const res = await getGlobalSdk().Status();
  const metaList = res.data?._meta ?? [];

  return metaList.reduce(
    (acc: Status, meta: { networkId?: number | null; progressBlock?: number | null }) => {
      const networkId = meta.networkId;
      if (networkId == null) return acc;
      const chain = getChainIdFromNetworkId(networkId);
      if (chain == null) return acc;
      acc[chain] = [
        ...(acc[chain] ?? []),
        {
          subgraph: 'envio',
          tag: 'latest',
          blockNumber: meta.progressBlock ?? null,
          timestamp: null,
          hasErrors: false,
        },
      ];
      return acc;
    },
    {} as Status
  );
}
