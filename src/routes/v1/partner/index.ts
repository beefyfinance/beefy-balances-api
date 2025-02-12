import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import balancer from './balancer';
import camelot from './camelot';

export default async function (
  instance: FastifyInstance,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
) {
  await instance.register(camelot, { prefix: '/camelot' });
  await instance.register(balancer, { prefix: '/balancer' });
  done();
}
