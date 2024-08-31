import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import holders from './holders';
import status from './status';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  instance.register(status, { prefix: '/status' });
  instance.register(holders, { prefix: '/holders' });
  done();
}
