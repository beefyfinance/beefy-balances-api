import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import holders from './holders';
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
  done();
}
