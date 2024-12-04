import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import camelot from './camelot';
export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  instance.register(camelot, { prefix: '/camelot' });
  done();
}
