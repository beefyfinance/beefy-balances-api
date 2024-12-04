import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import config from './config';
import contract from './contract';
import holders from './holders';
import partner from './partner';
import status from './status';
import vault from './vault';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  instance.register(status, { prefix: '/status' });
  instance.register(holders, { prefix: '/holders' });
  instance.register(vault, { prefix: '/vault' });
  instance.register(config, { prefix: '/config' });
  instance.register(contract, { prefix: '/contract' });
  instance.register(partner, { prefix: '/partner' });
  done();
}
