/**
 * safescript-express tests.
 * Tests the middleware without a real Express server.
 * All tests are async because SafeScript.run() now returns Promises.
 */
'use strict';

var path = require('path');
var fs = require('fs');
var safeRoutes = require('./index');

var pass = 0, fail = 0;

function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log('FAIL: ' + msg); }
}

function eq(a, b, msg) {
  var as = JSON.stringify(a), bs = JSON.stringify(b);
  if (as === bs) { pass++; } else { fail++; console.log('FAIL: ' + msg + '\n  expected: ' + bs + '\n  got:      ' + as); }
}

function tick(ms) { return new Promise(function(r) { setTimeout(r, ms || 50); }); }

// Create test handler directory
var testDir = path.join(__dirname, 'test-handlers');
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);

// Write test .safe files
fs.writeFileSync(path.join(testDir, 'hello.safe'), [
  '/**',
  ' * @safescript 0.2',
  ' * @needs request',
  ' */',
  'return { greeting: "hello", path: request.path };'
].join('\n'));

fs.writeFileSync(path.join(testDir, 'math.safe'), [
  '/**',
  ' * @safescript 0.2',
  ' * @needs request',
  ' * @needs math: Math',
  ' */',
  'var n = request.query.n || 16;',
  'return { sqrt: math.sqrt(n) };'
].join('\n'));

fs.writeFileSync(path.join(testDir, 'post-only.safe'), [
  '/**',
  ' * @env post',
  ' * @needs request',
  ' */',
  'return { received: request.body };'
].join('\n'));

// ── Mock Express req/res ────────────────────────────────────────

function mockReq(method, urlPath, opts) {
  opts = opts || {};
  return {
    method: method,
    url: urlPath,
    path: urlPath,
    query: opts.query || {},
    params: opts.params || {},
    headers: opts.headers || {},
    body: opts.body || null
  };
}

function mockRes() {
  var r = {
    _status: 200,
    _data: null,
    _type: null,
    status: function(code) { r._status = code; return r; },
    json: function(data) { r._data = data; r._type = 'json'; },
    send: function(data) { r._data = data; r._type = 'send'; }
  };
  return r;
}

// ── Run all tests ─────────────────────────────────────────────

(async function() {

  // ── Test: basic route ──────────────────────────────────────────
  {
    var mw = safeRoutes(testDir);
    var req = mockReq('GET', '/hello');
    var res = mockRes();
    var nextCalled = false;

    mw(req, res, function() { nextCalled = true; });
    eq(nextCalled, false, 'basic: next not called');
    await tick();
    eq(res._data.greeting, 'hello', 'basic: returns greeting');
    eq(res._data.path, '/hello', 'basic: passes request.path');
  }

  // ── Test: route with capabilities ──────────────────────────────
  {
    var mw = safeRoutes(testDir, {
      capabilities: function(caps) {
        return { math: Math };
      }
    });
    var req = mockReq('GET', '/math', { query: { n: 25 } });
    var res = mockRes();

    mw(req, res, function() {});
    await tick();
    eq(res._data.sqrt, 5, 'capabilities: math.sqrt works');
  }

  // ── Test: missing capability returns 500 ───────────────────────
  // Note: missing caps are caught synchronously by checkScope before run() is called
  {
    var mw = safeRoutes(testDir);  // no resolver → no math
    var req = mockReq('GET', '/math');
    var res = mockRes();

    mw(req, res, function() {});
    // checkScope failure is synchronous — no tick needed but harmless
    await tick();
    eq(res._status, 500, 'missing cap: status 500');
    assert(res._data.error.indexOf('math') >= 0, 'missing cap: error mentions math');
  }

  // ── Test: @env method routing ──────────────────────────────────
  {
    var mw = safeRoutes(testDir);

    // POST should match
    var req1 = mockReq('POST', '/post-only', { body: { x: 1 } });
    var res1 = mockRes();
    var next1 = false;
    mw(req1, res1, function() { next1 = true; });
    eq(next1, false, '@env: POST matches');
    await tick();
    eq(res1._data.received.x, 1, '@env: POST returns body');

    // GET should fall through (synchronous — next called immediately)
    var req2 = mockReq('GET', '/post-only');
    var res2 = mockRes();
    var next2 = false;
    mw(req2, res2, function() { next2 = true; });
    eq(next2, true, '@env: GET falls through');
  }

  // ── Test: unknown route falls through ──────────────────────────
  {
    var mw = safeRoutes(testDir);
    var req = mockReq('GET', '/nonexistent');
    var res = mockRes();
    var nextCalled = false;

    mw(req, res, function() { nextCalled = true; });
    eq(nextCalled, true, 'unknown route: next called');
  }

  // ── Test: directory traversal blocked ──────────────────────────
  {
    var mw = safeRoutes(testDir);
    var req = mockReq('GET', '/../package.json');
    var res = mockRes();
    var nextCalled = false;

    mw(req, res, function() { nextCalled = true; });
    eq(nextCalled, true, 'traversal: blocked');
  }

  // ── Test: single handler ───────────────────────────────────────
  {
    var handler = safeRoutes.handler(path.join(testDir, 'hello.safe'));
    var req = mockReq('GET', '/test');
    var res = mockRes();

    handler(req, res);
    // handler uses load() + run() which both return Promises — wait
    await tick(100);
    eq(res._data.greeting, 'hello', 'single handler: works');
  }

  // ── Cleanup ────────────────────────────────────────────────────

  fs.unlinkSync(path.join(testDir, 'hello.safe'));
  fs.unlinkSync(path.join(testDir, 'math.safe'));
  fs.unlinkSync(path.join(testDir, 'post-only.safe'));
  fs.rmdirSync(testDir);

  // ── Summary ────────────────────────────────────────────────────

  console.log('\nsafescript-express tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
