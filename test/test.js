import mocha from 'mocha';
import chai from 'chai';
import path from 'path';
import stream from 'stream';
import * as transforms from '../src/index.js';
import * as worker from '../src/worker/index.js';

const {suite, test} = mocha;
const {assert} = chai;


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


suite('transforms', () => {
  test('map', async () => {
    const r = stream.Readable.from([1, 2, 3]);

    /**
     * @param {number} x
     */
    const handler = async (x) => {
      return x + 1;
    };

    const s = r.pipe(transforms.map(handler));
    assert.sameMembers(await resultOf(s), [2, 3, 4]);
  });

  test('error', async () => {
    const r = stream.Readable.from([1]);

    const handler = async (x) => {
      throw new Error('lol what');
    };

    const s = r.pipe(transforms.map(handler));

    try {
      await resultOf(s);
      assert.fail('should not run, Promise should fail');
    } catch (err) {
      // ok
    }
  });

  test('reorder map', async () => {
    const r = stream.Readable.from([1, 2, 3]);
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
    assert.sameOrderedMembers(await resultOf(s), [4, 3, 2]);
  });

  test('enforce order map', async () => {
    const r = stream.Readable.from([1, 2, 3]);
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
    assert.sameOrderedMembers(await resultOf(s), [2, 3, 4]);
  });

  test('tasks', async () => {
    const r = stream.Readable.from([1, 2, 3]);

    let zCalled = false;
    let yDone = false;

    const handlers = [
      /**
       * @param {number} x
       */
      async (x) => {
        await new Promise((r) => setImmediate(r));
        assert.isFalse(zCalled);
        assert.isFalse(yDone);
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

    const handler = (x, index) => handlers[index](x);
    const s = r.pipe(transforms.map(handler, {tasks: 2}));
    assert.sameMembers(await resultOf(s), [2, 3, 4]);
  });

  test('skip', async () => {
    const r = stream.Readable.from([1, 2, 3]);

    const handler = (x) => {
      if (x === 2) {
        return transforms.skip;
      }
    };

    const s = r.pipe(transforms.map(handler));
    assert.sameMembers(await resultOf(s), [1, 3]);
  });

  test('filter', async () => {
    const source = [{v: 1, f: false}, {v: 2, f: true}];

    const s = stream.Readable.from(source).pipe(transforms.filter(({f}) => f));
    assert.sameMembers(await resultOf(s), [source[1]]);

    const empty = stream.Readable.from(source).pipe(transforms.filter(() => false));
    assert.isEmpty(await resultOf(empty));
  });

  test('gate', async () => {
    const r = stream.Readable.from([5, 6, 7]);

    const s = r.pipe(transforms.gate(async (all) => {
      all.reverse();
      all.push(1);
      return all;
    }));

    assert.sameOrderedMembers(await resultOf(s), [7, 6, 5, 1]);
  });

  test('non-object map', async () => {
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

    const handler = (buffer) => {
      buffer[0] = ' '.charCodeAt(0);
    };
    const s = r.pipe(transforms.map(handler, {objectMode: false}));

    const arr = await resultOf(s);
    assert.equal(arr.length, 2);
    assert.equal(arr[0].toString('utf8'), ' oo');
    assert.equal(arr[1].toString('utf8'), ' ar');
  });

  test('worker', async () => {
    const r = stream.Readable.from([5, 6, 7]);

    const absolutePath = String(import.meta.url).replace(/^file:\/\//, '');
    const dirname = path.dirname(absolutePath);

    const ext = worker.pool(path.join(dirname, './lib/worker.js'), {tasks: 2});
    const s = r.pipe(transforms.map(ext));

    assert.sameMembers(await resultOf(s), [15, 16, 17]);
  });
});
