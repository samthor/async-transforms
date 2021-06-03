[![Node.JS CI](https://github.com/samthor/async-transforms/actions/workflows/tests.yml/badge.svg)](https://github.com/samthor/async-transforms/actions/workflows/tests.yml)

Asynchronous stream transforms for Node.
Allows `async` handlers and parallel execution, useful for build systems like Gulp and friends.

## Install

Install `async-transforms` with your favourite package manager.

## Usage

Use `transforms.map`, `.filter` or `.gate` to generate a `stream.Transform` instance that calls the passed handler.

```js
// for example

import * as transforms from 'async-transforms';
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
  tasks: 5,     // limits number of parallel tasks
});
```

It's also possible to set `objectMode: false` (it's true by default) but this is unlikely to be useful to you.

### Gulp

This example uses `async-transforms` to parallelize rendering with Less.
This is important if e.g., Less is loading further files from the filesystem.

```js
const transforms = require('async-transforms');
const {src, dest} = require('gulp');
const less = require('less');

exports.default = () => {
  return src('*.less')
    .pipe(transforms.map(async (file) => {
      const result = await less.render(file.contents.toString('utf8'));
      file.contents = Buffer.from(result.css);
      file.extname = '.css';
    }))
    .pipe(dest('output'));
};
```

While Gulp plugins for Less already exist, this makes it easier to write general-purpose, modern plugins with `async` and `await` syntax.

## Worker Pool

This includes a submodule which provides a worker pool.
It's useful when combined with the above transforms handler.
For example:

```js
import {pool} from 'async-transforms/worker';

const asyncCompile = pool(path.resolve('./compile.js'), {tasks: 2});

// use directly
const result = await asyncCompile('input', 'all', 'args', 'are', 'passed');

// or as part of a transform
stream.Readable.from([object1, object2])
    .pipe(transforms.map(asyncCompile))
    .pipe(transforms.map(() => {
      // do something with the result
    }));
```

The pool invokes the default export (or `module.exports` for CJS) of the target file.
By default, it creates a maximum number of workers equal to 75% of your local CPUs, but set `tasks` to control this—use a fraction from 0-1 to set a ratio, and higher integers for an absolute number.

You can also specify `minTasks` to always keep a number of hot workers around.
This number can only be an integer, and defaults to 1.

Use this for CPU-bound tasks like JS minification.

This doesn't really belong in this module.
This can hold your binary 'open': if you're using the pool, be sure to `process.exit()` when you're done.
