'use strict';

const { HttpStatus } = require('../domain/constants');
const { sendJson } = require('./response');

class Router {
  constructor({ logger = console } = {}) {
    this.routes = [];
    this.logger = logger;
  }

  add(method, pattern, handler) {
    if (typeof pattern === 'string' && pattern.includes(':')) {
      pattern = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[a-zA-Z]+/g, '([^/]+)') + '$');
    }
    this.routes.push({ method, pattern, handler });
    return this;
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      for (const route of this.routes) {
        if (route.method !== req.method) continue;
        const match = typeof route.pattern === 'string'
          ? (url.pathname === route.pattern ? [] : null)
          : url.pathname.match(route.pattern);
        if (match) {
          await route.handler({ req, res, url, match });
          return;
        }
      }
      sendJson(res, HttpStatus.NOT_FOUND, { error: 'Not found' });
    } catch (error) {
      this.logger.error('Request failed:', error);
      if (!res.headersSent && !res.destroyed) {
        const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : HttpStatus.INTERNAL_ERROR;
        sendJson(res, status, { error: status < 500 ? error.message : 'Could not process the request. Please try again.' });
      } else if (!res.writableEnded) res.end();
    }
  }
}

module.exports = { Router };
