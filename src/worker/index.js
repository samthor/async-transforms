import worker from 'worker_threads';
import path from 'path';
import os from 'os';

/**
 * Determines the absolute directory where this script is contained.
 *
 * @return {{dirname: string, module: boolean}}
 */
function getScriptContext() {
  try {
    return {dirname: __dirname, module: false};
  } catch (e) {
    // We have to try __dirname first, as this way we can detect module mode correctly.
  }
  try {
    const {pathname: absolutePath} = new URL(import.meta.url);
    return {dirname: path.dirname(absolutePath), module: true};
  } catch (e) {
    throw new Error(`could not resolve __dirname or import.meta.url`);
  }
}

const {dirname: scriptDir, module: isModule} = getScriptContext();

const cpuCount = os.cpus().length || 4;
const workerTarget = path.join(scriptDir, './internal-worker.' + (isModule ? 'js' : 'cjs'));

/**
 * @param {string} dep to run script from
 * @param {Partial<import('.').PoolOptions>} options
 * @return {function(...any): Promise<any>}
 */
export function pool(dep, options) {
  /** @type {import('.').PoolOptions} */
  const o = Object.assign({
    minTasks: 1,
    tasks: cpuCount * 0.75,
    expiry: 1000,
  }, options);

  o.expiry = Math.max(o.expiry, 0) || 0;

  if (o.tasks > 0 && o.tasks < 1) {
    options.tasks = cpuCount * o.tasks;
  }
  options.tasks = Math.max(Math.ceil(o.tasks), 0) || 1;

  if (!path.isAbsolute(dep)) {
    throw new TypeError(`cannot load worker with relative path: ${dep}`);
  }

  let activeWorkers = 0;

  /** @type {Map<worker.Worker, NodeJS.Timeout>} */
  const availableWorkers = new Map();

  /** @type {{args: any[], resolve: (arg: any) => void}[]} */
  const pendingTasks = [];

  return async (...args) => {
    /** @type {worker.Worker} */
    let w;

    if (availableWorkers.size) {
      w = availableWorkers.keys().next().value;
      const timeout = /** @type {NodeJS.Timeout} */ (availableWorkers.get(w));
      availableWorkers.delete(w);
      clearTimeout(timeout);
    } else if (activeWorkers < o.tasks) {
      if (isModule) {
        w = new worker.Worker(workerTarget, {workerData: {dep}});
      } else {
        // In commonJS mode, we have to _again_ require the script, as the Worker ctor incorrectly
        // only allows ".js" (which attempts to run as a /module/, because of `type: module`) or
        // ".mjs" extensions (which is always a module).
        // This will probably be fixed in a future Node. Sounds like a bug.
        const code = `require(${JSON.stringify(workerTarget)});`;
        w = new worker.Worker(code, {workerData: {dep}, eval: true});
      }
      ++activeWorkers;
    } else {
      return new Promise((resolve) => {
        pendingTasks.push({args, resolve});
      });
    }

    return enact(w, args);
  };

  /**
   * @param {worker.Worker} w
   * @param {any[]} args
   * @return {Promise<any>}
   */
  function enact(w, args) {
    // While we could use the worker's parentPort, this gives us less risk of crosstalk.
    const {port1, port2} = new worker.MessageChannel();
    w.postMessage({args, port: port2}, [port2]);

    return new Promise((resolve, reject) => {
      /** @type {(arg: {result: any, error: Error}) => void} */
      const handler = ({result, error}) => {
        port1.off('message', handler);  // important to allow GC
        port1.close();
        error ? reject(error) : resolve(result);
        releaseWorker(w);
      };
      port1.on('message', handler);
    });
  }

  /**
   * @param {worker.Worker} w
   */
  function maybeTerimateWorker(w) {
    --activeWorkers;
    w.terminate();
    availableWorkers.delete(w);
  }

  /**
   * @param {worker.Worker} w
   */
  function releaseWorker(w) {
    const immediateTask = pendingTasks.shift();
    if (immediateTask) {
      // There's an immediate task, consume it and go.
      const {args, resolve} = immediateTask;
      resolve(enact(w, args));
    } else if (o.expiry) {
      // Otherwise, put it into our queue to be deleted soon.
      const timeout = setTimeout(maybeTerimateWorker.bind(null, w), o.expiry);
      availableWorkers.set(w, timeout);
    } else {
      maybeTerimateWorker(w);
    }
  }
}
