import worker from 'worker_threads';

if (worker.isMainThread) {
  throw new TypeError('cannot run on main thread');
}

/**
 * @param {number} x
 */
export default async function(x) {
  // try to come back in reverse order
  const delay = 40 - x;
  await new Promise((r) => setTimeout(r, delay));
  return x + 10;
}