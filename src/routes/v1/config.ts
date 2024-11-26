import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { chainIdSchema } from '../../config/chains';
import { getAsyncCache } from '../../utils/async-lock';
import { getBeefyVaultConfig } from '../../vault-breakdown/vault/getBeefyVaultConfig';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  const asyncCache = getAsyncCache();

  // all configs with point structure id of some chain
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;
    const responseSchema = Type.Object({
      vaults: Type.Array(Type.Any()),
    });

    const queryParamsSchema = Type.Object({
      include_eol: Type.Optional(Type.Boolean({ default: false })),
    });
    type QueryParams = Static<typeof queryParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      querystring: queryParamsSchema,
      response: {
        200: responseSchema,
      },
    };

    instance.get<{ Params: UrlParams; Querystring: QueryParams }>(
      '/:chain/vaults',
      { schema },
      async (request, reply) => {
        const { chain } = request.params;
        const { include_eol } = request.query;

        const result = await asyncCache.wrap(
          `config:${chain}`,
          5 * 60 * 1000,
          async () =>
            await getBeefyVaultConfig(chain, vault =>
              include_eol ? true : vault.status === 'active'
            )
        );
        reply.send(result);
      }
    );
  }

  done();
}
