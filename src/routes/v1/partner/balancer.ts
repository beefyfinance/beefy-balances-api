import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import { chainIdSchema } from '../../../config/chains';
import { getAsyncCache } from '../../../utils/async-lock';
import { getVaultHoldersAsBaseVaultEquivalentForVaultAddress } from '../../../utils/vault-holders';
import { getBeefyVaultConfig } from '../../../vault-breakdown/vault/getBeefyVaultConfig';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  const asyncCache = getAsyncCache();

  // Get balancer vault configs and holder balances for a chain
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
      block_number: Type.String(),
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const schema: FastifySchema = {
      tags: ['balancer'],
      params: urlParamsSchema,
      response: {
        200: Type.Array(Type.Any()),
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/config/:chain/:block_number/bundles',
      { schema },
      async (request, reply) => {
        const { chain, block_number } = request.params;

        const result = await asyncCache.wrap(
          `balancer:config:${chain}:${block_number}`,
          5 * 60 * 1000,
          async () => {
            const configs = await getBeefyVaultConfig(
              chain,
              vault =>
                vault.protocol_type === 'balancer_aura' || vault.underlyingPlatform === 'balancer'
            );

            // Get holder balances for each vault
            const vaultBalances = await Promise.all(
              configs.map(async vault => {
                const holders = await getVaultHoldersAsBaseVaultEquivalentForVaultAddress(
                  chain,
                  vault.vault_address,
                  BigInt(block_number)
                );
                return {
                  vault_config: vault,
                  holders,
                };
              })
            );

            return vaultBalances;
          }
        );

        reply.send(result);
      }
    );
  }

  done();
}
