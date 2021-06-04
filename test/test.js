import test from 'ava';
import * as path from 'path';
import * as stream from 'stream';
import * as transforms from '../src/index.js';
import * as worker from '../src/worker/index.js';



/**
 * @param {!stream.Readable} s
 */
function resultOf(s) {
  const {stream: check, promise: arrayPromise} = transforms.toArray();
  s.pipe(check);
  s.on('error', (err) => check.destroy(err));
  return arrayPromise;
}


/**
 * @param  {...function(): *} callable to invoke synchronously over as many frames
 */
async function invokeFrame(...callable) {
  for (const fn of callable) {
    await new Promise((r) => setImmediate(r));
    fn();
  }
}


test('map', async (t) => {
  const r = stream.Readable.from([1, 2, 3]);

  /**
   * @param {number} x
   */
  const handler = async (x) => {
    return x + 1;
  };

  const s = r.pipe(transforms.map(handler));
  t.deepEqual(await resultOf(s), [2, 3, 4]);
});

test('error', async (t) => {
  const r = stream.Readable.from([1]);

  const handler = () => {
    throw new Error('lol what');
  };

  const s = r.pipe(transforms.map(handler));
  await t.throwsAsync(() => resultOf(s));
});

test('reorder map', async (t) => {
  const r = stream.Readable.from([1, 2, 3]);

  /** @type {(() => void)[]} */
  const pending = [];

  /**
   * @param {number} x
   */
  const handler = (x) => {
    return new Promise((r) => {
      pending.unshift(() => r(x + 1));
      if (pending.length === 3) {
        invokeFrame(...pending);
      }
    });
  };

  const s = r.pipe(transforms.map(handler));
  t.deepEqual(await resultOf(s), [4, 3, 2]);
});

test('enforce order map', async (t) => {
  const r = stream.Readable.from([1, 2, 3]);

  /** @type {(() => void)[]} */
  const pending = [];

  /**
   * @param {number} x
   */
  const handler = (x) => {
    return new Promise((r) => {
      pending.unshift(() => r(x + 1));
      if (pending.length === 3) {
        invokeFrame(...pending);
      }
    });
  };

  const s = r.pipe(transforms.map(handler, {order: true}));
  t.deepEqual(await resultOf(s), [2, 3, 4]);
});

test('tasks', async (t) => {
  const r = stream.Readable.from([1, 2, 3]);

  let zCalled = false;
  let yDone = false;

  const handlers = [
    /**
     * @param {number} x
     */
    async (x) => {
      await new Promise((r) => setImmediate(r));
      t.false(zCalled);
      t.false(yDone);
      return x + 1;
    },

    /**
     * @param {number} y
     */
    async (y) => {
      await new Promise((r) => setImmediate(r));
      yDone = true;
      return y + 1;
    },

    /**
     * @param {number} z
     */
    async (z) => {
      zCalled = true;
      return z + 1;
    },
  ];

  /** @type {(x: number, index: number) => Promise<number>} */
  const handler = (x, index) => handlers[index](x);
  const s = r.pipe(transforms.map(handler, {tasks: 2}));
  t.deepEqual(await resultOf(s), [2, 4, 3]);
});

test('skip', async (t) => {
  const r = stream.Readable.from([1, 2, 3]);

  /** @type {(x: number) => Symbol|undefined} */
  const handler = (x) => {
    if (x === 2) {
      return transforms.skip;
    }
  };

  const s = r.pipe(transforms.map(handler));
  t.deepEqual(await resultOf(s), [1, 3]);
});

test('filter', async (t) => {
  const source = [{v: 1, f: false}, {v: 2, f: true}];

  const s = stream.Readable.from(source).pipe(transforms.filter(({f}) => f));
  t.deepEqual(await resultOf(s), [source[1]]);

  const empty = stream.Readable.from(source).pipe(transforms.filter(() => false));
  t.deepEqual(await resultOf(empty), []);
});

test('gate', async (t) => {
  const r = stream.Readable.from([5, 6, 7]);

  const s = r.pipe(transforms.gate(async (all) => {
    all.reverse();
    all.push(1);
    return all;
  }));

  t.deepEqual(await resultOf(s), [7, 6, 5, 1]);
});

test('non-object map', async (t) => {
  const source = [
    Buffer.from('foo', 'utf8'),
    Buffer.from('bar', 'utf8'),
  ];

  const r = new stream.Readable({
    objectMode: false,

    read() {
      if (source.length) {
        this.push(source.shift(), 'utf8');
      } else {
        this.push(null);
      }
    },
  });

  /** @type {(buffer: Buffer) => void} */
  const handler = (buffer) => {
    buffer[0] = ' '.charCodeAt(0);
  };
  const s = r.pipe(transforms.map(handler, {objectMode: false}));

  const arr = await resultOf(s);
  t.is(arr.length, 2);
  t.is(arr[0].toString('utf8'), ' oo');
  t.is(arr[1].toString('utf8'), ' ar');
});

test('worker', async (t) => {
  const sourceData = [5, 6, 7, 8, 9, 10];
  const outputData = [15, 16, 17, 18, 19, 20];

  const absolutePath = String(import.meta.url).replace(/^file:\/\//, '');
  const dirname = path.dirname(absolutePath);

  const ext = worker.pool(path.join(dirname, './lib/_worker.js'), {tasks: 2});

  // transforms.map doesn't by default guarantee order
  const sAny = stream.Readable.from(sourceData).pipe(transforms.map(ext));
  const resultAny = await resultOf(sAny);

  // It's incredibly unlikely that this is ordered properly, because we return results in reverse
  // order via timeout.
  t.notDeepEqual(resultAny, outputData);

  resultAny.sort();
  t.deepEqual(resultAny, outputData);

  // but we can test with the flag too
  const s = stream.Readable.from(sourceData).pipe(transforms.map(ext, {order: true}));
  const result = await resultOf(s);
  t.deepEqual(result, outputData);
});
