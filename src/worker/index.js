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
    o.tasks = cpuCount * o.tasks;
  }
  o.tasks = Math.max(Math.ceil(o.tasks), 0) || 1;
  o.minTasks = Math.max(0, Math.min(o.tasks, ~~o.minTasks));

  if (!path.isAbsolute(dep)) {
    throw new TypeError(`cannot load worker with relative path: ${dep}`);
  }

  let preparingNewWorker = false;
  let activeWorkers = 0;

  /** @type {Map<worker.Worker, NodeJS.Timeout|undefined>} */
  const availableWorkers = new Map();

  const prepareWorker = () => {
    ++activeWorkers;
    const w = createWorker(dep);
    w.on('message', ({ok}) => {
      if (ok !== true) {
        throw new Error(`got non-ok: ${ok}`);
      }
      preparingNewWorker = false;
      releaseWorker(w);
    });
  };
  for (let i = 0; i < o.minTasks; ++i) {
    prepareWorker();
  }

  /** @type {{args: any[], resolve: (arg: any) => void}[]} */
  const pendingTasks = [];

  return async (...args) => {
    if (availableWorkers.size) {
      /** @type {worker.Worker} */
      const w = availableWorkers.keys().next().value;
      const timeout = availableWorkers.get(w);
      availableWorkers.delete(w);
      timeout && clearTimeout(timeout);
      return enact(w, args);
    }

    // Start a new worker, but still push the work onto the queue for when it's ready.
    if (!preparingNewWorker && activeWorkers < o.tasks) {
      preparingNewWorker = true;
      prepareWorker();
    }

    return new Promise((resolve) => {
      pendingTasks.push({args, resolve});
    });
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
    if (activeWorkers > o.minTasks) {
      w.terminate();
      availableWorkers.delete(w);
    } else {
      availableWorkers.set(w, undefined);
    }
    --activeWorkers;
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
    } else if (isFinite(o.expiry)) {
      // Otherwise, put it into our queue to be deleted soon.
      const timeout = setTimeout(maybeTerimateWorker.bind(null, w), o.expiry);
      availableWorkers.set(w, timeout);
    } else {
      availableWorkers.set(w, undefined);
    }
  }
}


/**
 * @param {string} dep
 */
function createWorker(dep) {
  let w;
  if (isModule) {
    return new worker.Worker(workerTarget, {workerData: {dep}});
  }

  // In commonJS mode, we have to _again_ require the script, as the Worker ctor incorrectly
  // only allows ".js" (which attempts to run as a /module/, because of `type: module`) or
  // ".mjs" extensions (which is always a module).
  // This will probably be fixed in a future Node. Sounds like a bug.
  const code = `require(${JSON.stringify(workerTarget)});`;
  return new worker.Worker(code, {workerData: {dep}, eval: true});
}
