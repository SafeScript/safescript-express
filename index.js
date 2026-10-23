/**
 * safescript-express — Express middleware for SafeScript .safe route handlers.
 *
 * Usage:
 *   const safeRoutes = require('safescript-express');
 *   app.use('/api', safeRoutes('./handlers', { capabilities: myResolver }));
 */
'use strict';

var fs = require('fs');
var path = require('path');
var SafeScript = require('safescript');

/**
 * Create an Express router that loads .safe files as route handlers.
 *
 * Each .safe file becomes a route:
 *   handlers/hello.safe       → GET /hello
 *   handlers/users/list.safe  → GET /users/list
 *   handlers/users/create.safe → POST /users/create  (if @env includes 'post')
 *
 * The .safe file receives `request` and `response` as capabilities,
 * plus anything the resolver provides.
 *
 * @param {string} dir - Directory containing .safe files
 * @param {Object} opts - Options
 * @param {Function} [opts.capabilities] - function(caps, req, res) → scope
 * @param {boolean} [opts.watchChanges] - Reload .safe files on change
 * @returns {Function} Express middleware
 */
function safeRoutes(dir, opts) {
  opts = opts || {};
  var resolvedDir = path.resolve(dir);
  var cache = Object.create(null);

  function loadFile(filePath) {
    var source = fs.readFileSync(filePath, 'utf8');
    var caps = SafeScript.capabilities(source);
    var compiled = SafeScript.compile(source);
    return { source: source, caps: caps, compiled: compiled };
  }

  function getHandler(filePath) {
    if (!opts.watchChanges && cache[filePath]) {
      return cache[filePath];
    }
    try {
      var handler = loadFile(filePath);
      cache[filePath] = handler;
      return handler;
    } catch(e) {
      return null;
    }
  }

  /**
   * Build the scope for a request.
   * Always provides request/response wrappers.
   * The resolver can add more.
   */
  function buildScope(handler, req, res) {
    var scope = {
      request: {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query || {},
        params: req.params || {},
        headers: req.headers || {},
        body: req.body,
        json: function() { return req.body; }
      },
      response: {
        send: function(data) { return { __response: 'send', data: data }; },
        json: function(data) { return { __response: 'json', data: data }; },
        status: function(code) {
          return {
            send: function(data) { return { __response: 'send', data: data, status: code }; },
            json: function(data) { return { __response: 'json', data: data, status: code }; }
          };
        }
      }
    };

    if (opts.capabilities) {
      var extra = opts.capabilities(handler.caps, req, res);
      if (extra) {
        var keys = Object.keys(extra);
        for (var i = 0; i < keys.length; i++) {
          scope[keys[i]] = extra[keys[i]];
        }
      }
    }

    return scope;
  }

  function handleResult(result, res) {
    if (result && result.__response) {
      if (result.status) res.status(result.status);
      if (result.__response === 'json') {
        res.json(result.data);
      } else {
        res.send(result.data);
      }
    } else {
      res.json(result);
    }
  }

  return function middleware(req, res, next) {
    // Map URL path to .safe file
    var urlPath = req.path.replace(/^\/+|\/+$/g, '');
    if (!urlPath) urlPath = 'index';

    var filePath = path.join(resolvedDir, urlPath + '.safe');

    // Prevent directory traversal
    if (path.resolve(filePath).indexOf(resolvedDir) !== 0) {
      return next();
    }

    var handler = getHandler(filePath);
    if (!handler) return next();

    // Check @env for method routing
    var env = handler.caps.env;
    if (env) {
      var method = req.method.toLowerCase();
      if (env.indexOf(method) < 0 && env.indexOf('any') < 0) {
        return next();
      }
    }

    try {
      var scope = buildScope(handler, req, res);
      var check = SafeScript.checkScope(handler.source, scope);
      if (!check.ok) {
        return res.status(500).json({
          error: 'Missing capabilities: ' + check.missing.join(', ')
        });
      }

      SafeScript.run(handler.source, scope).then(function(result) {
        handleResult(result, res);
      }).catch(function(e) {
        res.status(500).json({ error: e.message });
      });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  };
}

/**
 * Load a single .safe file and return an Express handler.
 *
 * @param {string} filePath - Path to .safe file
 * @param {Function} [resolver] - function(caps, req, res) → scope
 * @returns {Function} Express route handler
 */
safeRoutes.handler = function(filePath, resolver) {
  var source = fs.readFileSync(path.resolve(filePath), 'utf8');

  return function(req, res) {
    SafeScript.load(source, function(caps) {
      var scope = {
        request: {
          method: req.method,
          url: req.url,
          path: req.path,
          query: req.query || {},
          params: req.params || {},
          headers: req.headers || {},
          body: req.body,
          json: function() { return req.body; }
        }
      };
      if (resolver) {
        var extra = resolver(caps, req, res);
        if (extra) {
          var keys = Object.keys(extra);
          for (var i = 0; i < keys.length; i++) {
            scope[keys[i]] = extra[keys[i]];
          }
        }
      }
      return scope;
    }).then(function(bundle) {
      return SafeScript.run(bundle);
    }).then(function(result) {
      if (result && result.__response) {
        if (result.status) res.status(result.status);
        if (result.__response === 'json') res.json(result.data);
        else res.send(result.data);
      } else {
        res.json(result);
      }
    }).catch(function(e) {
      res.status(500).json({ error: e.message });
    });
  };
};

module.exports = safeRoutes;
