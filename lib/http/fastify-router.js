'use strict';

const Fastify = require('fastify');

// Adapter keeps feature route contracts stable during the incremental migration.
class FastifyRouter {
  constructor({ logger = console } = {}) {
    this.app = Fastify({ logger: false, bodyLimit: 50_000_000, exposeHeadRoutes: false });
    this.app.removeAllContentTypeParsers();
    this.app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    this.app.setNotFoundHandler((_request, reply) => {
      reply.code(404).header('cache-control', 'no-store').send({ error: 'Not found' });
    });
    this.app.setErrorHandler((error, _request, reply) => {
      const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
      if (status === 500) logger.error('Request failed:', error);
      reply.code(status).header('cache-control', 'no-store').send({
        error: status === 500 ? 'Could not process the request. Please try again.' : error.message
      });
    });
  }

  add(method, pattern, handler) {
    const matcher = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[a-zA-Z]+/g, '([^/]+)') + '$');
    this.app.route({
      method,
      url: pattern,
      handler: async (request, reply) => {
        const url = new URL(request.raw.url, 'http://localhost');
        return handler({ req: request, res: reply, url, match: url.pathname.match(matcher) });
      }
    });
    return this;
  }
}

module.exports = { FastifyRouter };
