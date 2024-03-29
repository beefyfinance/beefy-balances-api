import Fastify from 'fastify';
import FastifyHelmet from '@fastify/helmet';
import FastifyRateLimit from '@fastify/rate-limit';
import FastifyUnderPressure from '@fastify/under-pressure';
import FastifyEtag from '@fastify/etag';
import FastifyCors from '@fastify/cors';
import { defaultLogger } from './utils/log.js';
import routes from './routes/index.js';
import { API_CORS_ORIGIN, API_ENV, API_PORT, API_RATE_LIMIT } from './config/env.js';

const server = Fastify({
  logger: defaultLogger,
  trustProxy: true,
});

server.register(async (instance, _opts, done) => {
  instance
    .register(FastifyUnderPressure)
    .register(FastifyHelmet, { contentSecurityPolicy: API_ENV === 'production' })
    .register(FastifyRateLimit, {
      global: true,
      timeWindow: '1 minute',
      max: API_RATE_LIMIT,
      continueExceeding: true,
      skipOnError: false,
      enableDraftSpec: true,
    })
    .register(FastifyEtag)
    .register(FastifyCors, {
      methods: ['GET'],
      origin: API_ENV === 'production' ? API_CORS_ORIGIN : true,
    })
    .setReplySerializer(function (payload) {
      return JSON.stringify(payload, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
    })
    .addHook('onSend', async (_req, reply) => {
      if (reply.raw.statusCode !== 200) {
        reply.header('cache-control', 'no-cache, no-store, must-revalidate');
      }
    })
    .setErrorHandler((error, _request, reply) => {
      reply.header('cache-control', 'no-cache, no-store, must-revalidate');
      if (API_ENV === 'development') {
        reply.send(error);
      } else {
        defaultLogger.error(error);
        reply.status(error.statusCode || 500).send({ error: error.name });
      }
    })
    .register(routes, { prefix: '/api/v1' });

  done();
});

server.listen({ port: API_PORT, host: '0.0.0.0' }, err => {
  if (err) {
    defaultLogger.error(err);
    process.exit(1);
  }
});