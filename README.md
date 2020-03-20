Asynchronous stream transforms for Node.
Allows `async` handlers and parallel execution, useful for build systems like Gulp and friends.

## Install

Install `async-transforms` with your favourite package manager.
You'll need Node v13+ as this is shipped as ESM.

## Usage

Use `transforms.map`, `.filter` or `.gate` to generate a `stream.Transform` instance that calls the passed handler.

```js
// for example

import * as transforms from './transforms.js';
import 'stream';

stream.pipeline(
  stream.Readable.from([object1, object2]),  // used for demo
  transforms.map(async (object) => {
    await object.expensiveOperation;
    await object.someOtherThing;
  }),
  createOutputStream('./foo'),
  (err) => {
    // callback
  },
)
```

These transforms operate in parallel and don't guarantee the order of their output (whatever finishes first).
You can set options to configure behavior:

```js
const s = transforms.map(handler, {
  order: true,  // force the same output order
  tasks: 100,   // set to positive to limit number of tasks
});
```

It's also possible to set `objectMode: false` (it's true by default) but this is unlikely to be useful to you.

### Gulp

