[![Build](https://api.travis-ci.org/samthor/async-transforms.svg?branch=master)](https://travis-ci.org/samthor/async-transforms)

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

const compilationPool = pool(path.resolve('./compile.js'));

// use directly
compilationPool(123, {tasks: 2})
    .then((result) => console.info('result from passing value to worker', result));

// or as part of a transform
stream.Readable.from([object1, object2])
    .pipe(transforms.map(compilationPool))
    .pipe(transforms.map(() => {
      // do something with the result
    }));
```

The pool invokes the default export (or `module.exports` for CJS) of the target file.
By default, it utilizes 75% of your local CPUs, but set `tasks` to control this—use a fraction from 0-1 to set a ratio, and higher for absolute.

Use this for CPU-bound tasks like JS minification.

This doesn't really belong in this module.
