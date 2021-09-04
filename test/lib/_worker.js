import worker from 'worker_threads';

if (worker.isMainThread) {
  throw new TypeError('cannot run on main thread');
}

/**
 * @param {number} x
 */
export default async function(x) {
  // try to come back in reverse order
  await new Promise((r) => setTimeout(r, x));
  return x + 10;
}