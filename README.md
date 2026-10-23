# safescript-express

Express middleware for [SafeScript](https://github.com/SafeScript/safescript) `.safe` route handlers.

Drop `.safe` files in a directory and they become Express routes. Each handler runs in SafeScript's sandbox — no `eval`, no globals, no prototype access. You control what capabilities each handler gets.

## Install

```bash
npm install safescript-express safescript
```

## Usage

### Directory of handlers

```
handlers/
  hello.safe
  users/list.safe
  users/create.safe
```

```js
const express = require('express');
const safeRoutes = require('safescript-express');

const app = express();

app.use('/api', safeRoutes('./handlers', {
  capabilities: function(caps, req, res) {
    // Return additional scope based on what the .safe file @needs
    return { db: myDatabase, auth: myAuthService };
  }
}));

app.listen(3000);
```

Now `GET /api/hello` runs `handlers/hello.safe`, `GET /api/users/list` runs `handlers/users/list.safe`, etc.

### Single handler

```js
const safeRoutes = require('safescript-express');

app.get('/compute', safeRoutes.handler('./handlers/compute.safe', function(caps, req) {
  return { math: Math };
}));
```

### Example .safe handler

```js
/**
 * @safescript 0.2
 * @needs request
 * @needs db: Database
 * @uses logger: Logger
 * @env get, post
 */
var body = request.json();
if (logger) logger.log('received', body);
return response.json(db.store(body));
```

## Method routing

The `@env` directive controls which HTTP methods a handler responds to. A handler with `@env get` only handles GET requests — others fall through to the next middleware. Without `@env`, a handler responds to any method.

## Options

| Option | Type | Description |
|--------|------|-------------|
| `capabilities` | `function(caps, req, res) → object` | Resolve additional scope entries for each request |
| `watchChanges` | `boolean` | Reload .safe files on each request (dev mode) |

## How it works

1. Map the URL path to a `.safe` file in the directory
2. Parse the file's header for `@needs`, `@uses`, `@env`
3. Check the HTTP method against `@env` (if declared)
4. Build the scope: `request` and `response` wrappers plus whatever your resolver returns
5. Validate that all `@needs` are satisfied
6. Run the SafeScript code in the sandbox
7. Send the return value as JSON

The handler never sees Express internals, Node globals, or anything you don't explicitly provide. A handler that declares `@needs db: Database` will refuse to run if you don't provide `db`.

## License

MIT — Gregory Magarshak
