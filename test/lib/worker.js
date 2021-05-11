import worker from 'worker_threads';

if (worker.isMainThread) {
  throw new TypeError('cannot run on main thread');
}

/**
 * @param {number} x
 */
export default async function(x) {
  await new Promise((r) => setTimeout(r, 10));
  return x + 10;
}