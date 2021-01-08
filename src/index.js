import stream from 'stream';

const filterSymbol = Symbol('filter');


/**
 * If returned by the map function, will skip this item in the final output.
 */
export const skip = filterSymbol;


/**
 * Build a mapping stream. This runs in parallel over receved chunks.
 *
 * Unlike the built-in Array.map function, returning null or undefined from the mapper will push
 * the same chunk onto the output. This acts more like forEach.
 *
 * By default, this operates in objectMode, and does not guarantee that the output order matches
 * the input order.
 *
 * @param {function(?, number): ?} handler
 * @param {{objectMode: boolean, order: boolean, tasks: number}=} options
 * @return {!stream.Transform}
 */
export function map(handler, options={}) {
  options = Object.assign({
    objectMode: true,
    order: false,
    tasks: 0,
  }, options);

  let index = 0;
  let count = 0;
  let flushCallback = null;

  options.tasks = Math.ceil(options.tasks) || 0;
  const hasTasks = options.tasks > 0;
  const pending = [];

  let orderPushCount = 0;
  const orderDone = [];

  const s = new stream.Transform({
    objectMode: options.objectMode,
    // nb. Passing writeableHighWaterMark here seems to do nothing, we just enforce tasks manually.

    transform(chunk, encoding, callback) {
      if (flushCallback !== null) {
        throw new Error(`got transform() after flush()`);
      }

      callback();

      if (!hasTasks || count < options.tasks) {
        internalTransform(chunk, encoding);
      } else {
        pending.push({chunk, encoding});
      }
    },

    flush(callback) {
      if (count === 0) {
        callback();  // nothing was pushed, callback immediately
      } else {
        flushCallback = callback;
      }
    },
  });

  return s;

  // hoisted methods below

  function internalTransform(chunk, encoding) {
    ++count;
    const localIndex = index++;
    const resultHandler = internalResultHandler.bind(null, localIndex, chunk);
    Promise.resolve()
        .then(() => handler(chunk, localIndex))
        .then(resultHandler)
        .catch((err) => s.destroy(err));
  }

  function internalResultHandler(localIndex, chunk, result) {
    if (result == null) {
      result = chunk;  // disallow null/undefined as they stop streams
    }

    if (options.order) {
      const doneIndex = localIndex - orderPushCount;
      orderDone[doneIndex] = result;

      // If we're the first, ship ourselves and any further completed chunks.
      if (doneIndex === 0) {
        let i = doneIndex;
        do {
          if (orderDone[i] !== filterSymbol) {
            s.push(orderDone[i]);
          }
          ++i;
        } while (i < orderDone.length && orderDone[i] !== undefined);

        // Splice at once, in case we hit many valid elements.
        orderDone.splice(0, i);
        orderPushCount += i;
      }
    } else if (result !== filterSymbol) {
      s.push(result);  // we don't care about the order, push immediately
    }

    --count;

    if (pending.length && count < options.tasks) {
      const {chunk, encoding} = pending.shift();
      internalTransform(chunk, encoding);
    } else if (count === 0 && flushCallback) {
      // this is safe as `else if`, as calling internalTransform again means count > 0
      flushCallback();
    }
  }
}


/**
 * As per map, but returning falsey values will remove this from the stream. Returning a truthy
 * value will include it.
 *
 * @param {function(?, number): ?} handler
 * @param {{objectMode: boolean, order: boolean, tasks: number}=} options
 * @return {!stream.Transform}
 */
export function filter(handler, options={}) {
  return map(async (chunk) => {
    const result = await handler(chunk);
    return result ? chunk : filterSymbol;
  }, options);
}


/**
 * Asynchronously process all data passed through this stream prior to 'flush' being invoked. This
 * gates the throughput and pushes the array of returned values.
 *
 * This assumes object mode and does not validate or check encoding.
 *
 * @param {function(!Array<?>): (!Array<?>|!Promise<!Array<?>>}
 * @return {!stream.Transform}
 */
export function gate(handler) {
  const chunks = [];

  return new stream.Transform({
    objectMode: true,

    transform(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    },

    flush(callback) {
      Promise.resolve(handler(chunks)).then((result) => {
        if (result == null) {
          result = chunks;
        }
        // Technically, we allow anything iterable to be returned.
        for (const each of result) {
          this.push(each);
        }
        callback();
      }).catch(callback);
    },

  });
}


/**
 * Returns a helper that generates an Array from piped data. This assumes object mode.
 */
export function toArray() {
  let s;
  const promise = new Promise((resolve, reject) => {
    s = gate((arr) => resolve(arr));
    s.on('error', reject);
  });
  return {stream: s, promise};
}
