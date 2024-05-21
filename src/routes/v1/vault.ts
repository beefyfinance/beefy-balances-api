import { FastifyInstance, FastifyPluginOptions, FastifySchema } from 'fastify';
import S from 'fluent-json-schema';
import { ChainId } from '../../config/chains';
import { addressSchema } from '../../schema/address';
import { GraphQueryError } from '../../utils/error';
import { sdk } from '../../utils/sdk';
import { getPeriodSeconds, Period, periodSchema } from '../../schema/period';
import { chainSchema } from '../../schema/chain';
import { bigintSchema } from '../../schema/bigint';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  // latest price
  {
    type UrlParams = {
      chain: ChainId;
      vault_address: string;
    };

    const urlParamsSchema = S.object()
      .prop('chain', chainSchema.required().description('The chain the vault is on'))
      .prop('vault_address', addressSchema.required().description('The vault contract address'));

    const responseSchema = S.array().items(S.object());

    const schema: FastifySchema = {
      tags: ['v1'],
      params: urlParamsSchema,
      response: {
        200: responseSchema,
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:chain/:vault_address/price',
      { schema },
      async (request, reply) => {
        const { chain, vault_address } = request.params;
        const result = await getVaultPrice(chain, vault_address);
        if (result === undefined) {
          reply.status(404);
          reply.send({ error: 'Vault not found' });
          return;
        }
        reply.send(result);
      }
    );
  }

  // historical prices
  {
    type UrlParams = {
      chain: ChainId;
      vault_address: string;
      period: Period;
      since: string;
    };

    const urlParamsSchema = S.object()
      .prop('chain', chainSchema.required().description('The chain the vault is on'))
      .prop('vault_address', addressSchema.required().description('The vault contract address'))
      .prop('period', periodSchema.required().description('The snapshot period for prices'))
      .prop('since', bigintSchema.required().description('The unix timestamp to start from'));

    const responseSchema = S.array().items(S.object());

    const schema: FastifySchema = {
      tags: ['v1'],
      params: urlParamsSchema,
      response: {
        200: responseSchema,
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:chain/:vault_address/prices/:period/:since',
      { schema },
      async (request, reply) => {
        const { chain, vault_address, period, since } = request.params;
        const result = await getVaultHistoricPrices(chain, vault_address, period, since);
        if (result === undefined) {
          reply.status(404);
          reply.send({ error: 'Vault not found' });
          return;
        }
        reply.send(result);
      }
    );
  }

  // historical data availability
  {
    type UrlParams = {
      chain: ChainId;
      vault_address: string;
      period: Period;
    };

    const urlParamsSchema = S.object()
      .prop('chain', chainSchema.required().description('The chain the vault is on'))
      .prop('vault_address', addressSchema.required().description('The vault contract address'))
      .prop('period', periodSchema.required().description('The snapshot period for prices'));

    const responseSchema = S.array().items(S.object());

    const schema: FastifySchema = {
      tags: ['v1'],
      params: urlParamsSchema,
      response: {
        200: responseSchema,
      },
    };

    instance.get<{ Params: UrlParams }>(
      '/:chain/:vault_address/prices/range/:period',
      { schema },
      async (request, reply) => {
        const { chain, vault_address, period } = request.params;
        const result = await getVaultHistoricPricesRange(chain, vault_address, period);
        if (result === undefined) {
          reply.status(404);
          reply.send({ error: 'Vault not found' });
          return;
        }
        reply.send(result);
      }
    );
  }

  done();
}

const getVaultPrice = async (chain: ChainId, vault_address: string) => {
  const res = await sdk
    .VaultPrice(
      {
        vault_address,
      },
      { chainName: chain }
    )
    .catch((e: unknown) => {
      // we have nothing to leak here
      throw new GraphQueryError(e);
    });

  if (!res.beefyCLVault) {
    return undefined;
  }

  return {
    min: res.beefyCLVault.priceRangeMin1,
    current: res.beefyCLVault.priceOfToken0InToken1,
    max: res.beefyCLVault.priceRangeMax1,
  };
};

const getVaultHistoricPrices = async (
  chain: ChainId,
  vault_address: string,
  period: Period,
  since: string
) => {
  const res = await sdk
    .VaultHistoricPrices(
      {
        vault_address,
        period: getPeriodSeconds(period),
        since,
      },
      { chainName: chain }
    )
    .catch((e: unknown) => {
      // we have nothing to leak here
      throw new GraphQueryError(e);
    });

  if (!res.beefyCLVault) {
    return undefined;
  }

  if (!res.beefyCLVault.snapshots?.length) {
    return [];
  }

  return res.beefyCLVault.snapshots.map(snapshot => ({
    t: parseInt(snapshot.roundedTimestamp),
    min: snapshot.priceRangeMin1,
    v: snapshot.priceOfToken0InToken1,
    max: snapshot.priceRangeMax1,
  }));
};

const getVaultHistoricPricesRange = async (
  chain: ChainId,
  vault_address: string,
  period: Period
) => {
  const res = await sdk
    .VaultHistoricPricesRange(
      {
        vault_address,
        period: getPeriodSeconds(period),
      },
      { chainName: chain }
    )
    .catch((e: unknown) => {
      // we have nothing to leak here
      throw new GraphQueryError(e);
    });

  if (!res.beefyCLVault) {
    return undefined;
  }

  return {
    min: parseInt(res.beefyCLVault.minSnapshot?.[0]?.roundedTimestamp || 0),
    max: parseInt(res.beefyCLVault.maxSnapshot?.[0]?.roundedTimestamp || 0),
  };
};