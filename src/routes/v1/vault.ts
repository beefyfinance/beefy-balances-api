import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import type { Hex } from 'viem';
import { chainIdSchema } from '../../config/chains';
import { addressSchema } from '../../schema/address';
import { bigintSchema } from '../../schema/bigint';
import { getAsyncCache } from '../../utils/async-lock';
import {
  getVaultHolders,
  getVaultHoldersAsBaseVaultEquivalentForStrategyAddress,
  getVaultHoldersAsBaseVaultEquivalentForVaultAddress,
  getVaultHoldersAsBaseVaultEquivalentForVaultId,
  vaultHoldersSchema,
} from '../../utils/vault-holders';

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

    const queryParamsSchema = Type.Object({
      balance_gt: Type.Optional(bigintSchema),
    });
    type QueryParams = Static<typeof queryParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      querystring: queryParamsSchema,
      response: {
        200: vaultHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams; Querystring: QueryParams }>(
      '/:chain/:vault_id/:block_number/share-tokens-balances',
      { schema },
      async (request, reply) => {
        const { chain, vault_id: input_vault_id, block_number } = request.params;
        const { balance_gt } = request.query;
        const vault_id = input_vault_id.replace(/-(rp|vault)$/, '');

        if (vault_id !== input_vault_id) {
          reply.code(301);
          reply.redirect(
            `/api/v1/vault/${chain}/${vault_id}/${block_number}/share-tokens-balances`
          );
          return;
        }

        const result = await asyncCache.wrap(
          `vault:${chain}:${vault_id}:${block_number}:${balance_gt}:holders`,
          5 * 60 * 1000,
          async () =>
            await getVaultHolders(
              chain,
              vault_id,
              BigInt(block_number),
              balance_gt ? BigInt(balance_gt) : 0n
            )
        );
        reply.send(result);
      }
    );
  }

  // all holder count list for all chains
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
      vault_id: Type.String({ description: 'The vault id or clm manager id or reward pool id' }),
      block_number: bigintSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const queryParamsSchema = Type.Object({
      balance_gt: Type.Optional(bigintSchema),
    });
    type QueryParams = Static<typeof queryParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      querystring: queryParamsSchema,
      response: {
        200: vaultHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams; Querystring: QueryParams }>(
      '/:chain/:vault_id/:block_number/bundle-holder-share',
      { schema },
      async (request, reply) => {
        const { chain, vault_id: input_vault_id, block_number } = request.params;
        const { balance_gt } = request.query;
        const base_vault_id = input_vault_id.replace(/-(rp)$/, '');

        if (base_vault_id !== input_vault_id) {
          reply.code(301);
          reply.redirect(
            `/api/v1/vault/${chain}/${base_vault_id}/${block_number}/bundle-holder-share`
          );
          return;
        }

        const result = await asyncCache.wrap(
          `vault:${chain}:${base_vault_id}:${block_number}:${balance_gt}:holders`,
          5 * 60 * 1000,
          async () =>
            getVaultHoldersAsBaseVaultEquivalentForVaultId(
              chain,
              base_vault_id,
              BigInt(block_number),
              balance_gt ? BigInt(balance_gt) : 0n
            )
        );

        reply.send(result);
      }
    );
  }

  // all holder count list for all chains
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
      vault_address: addressSchema,
      block_number: bigintSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const queryParamsSchema = Type.Object({
      balance_gt: Type.Optional(bigintSchema),
    });
    type QueryParams = Static<typeof queryParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      querystring: queryParamsSchema,
      response: {
        200: vaultHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams; Querystring: QueryParams }>(
      '/:chain/:vault_address/:block_number/bundle-holder-share-by-vault-address',
      { schema },
      async (request, reply) => {
        const { chain, vault_address, block_number } = request.params;
        const { balance_gt } = request.query;

        const result = await asyncCache.wrap(
          `vault:${chain}:${vault_address.toLowerCase()}:${block_number}:${balance_gt}:holders`,
          5 * 60 * 1000,
          async () =>
            getVaultHoldersAsBaseVaultEquivalentForVaultAddress(
              chain,
              vault_address as Hex,
              BigInt(block_number),
              balance_gt ? BigInt(balance_gt) : 0n
            )
        );

        reply.send(result);
      }
    );
  }

  // all holder count list for all chains
  {
    const urlParamsSchema = Type.Object({
      chain: chainIdSchema,
      strategy_address: addressSchema,
      block_number: bigintSchema,
    });
    type UrlParams = Static<typeof urlParamsSchema>;

    const queryParamsSchema = Type.Object({
      balance_gt: Type.Optional(bigintSchema),
    });
    type QueryParams = Static<typeof queryParamsSchema>;

    const schema: FastifySchema = {
      tags: ['vault'],
      params: urlParamsSchema,
      querystring: queryParamsSchema,
      response: {
        200: vaultHoldersSchema,
      },
    };

    instance.get<{ Params: UrlParams; Querystring: QueryParams }>(
      '/:chain/:strategy_address/:block_number/bundle-holder-share-by-strategy-address',
      { schema },
      async (request, reply) => {
        const { chain, strategy_address, block_number } = request.params;
        const { balance_gt } = request.query;

        const result = await asyncCache.wrap(
          `vault:${chain}:${strategy_address.toLowerCase()}:${block_number}:${balance_gt}:holders`,
          5 * 60 * 1000,
          async () =>
            getVaultHoldersAsBaseVaultEquivalentForStrategyAddress(
              chain,
              strategy_address as Hex,
              BigInt(block_number),
              balance_gt ? BigInt(balance_gt) : 0n
            )
        );

        reply.send(result);
      }
    );
  }

  done();
}
