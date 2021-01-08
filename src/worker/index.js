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
 * @param {{tasks?: number, expiry?: number}} options
 * @return {function(...any): Promise<any>}
 */
export function pool(dep, options) {
  options = Object.assign({
    tasks: cpuCount * 0.75,
    expiry: 1000,
  }, options);

  options.expiry = Math.max(options.expiry, 0) || 0;

  if (options.tasks > 0 && options.tasks < 1) {
    options.tasks = cpuCount * options.tasks;
  }
  options.tasks = Math.max(Math.ceil(options.tasks), 0) || 1;

  if (!path.isAbsolute(dep)) {
    throw new TypeError(`cannot load worker with relative path: ${dep}`);
  }

  let activeWorkers = 0;

  /** @type {Map<worker.Worker, number>} */
  const availableWorkers = new Map();

  /** @type {{args: any[], resolve: (any) => void}[]} */
  const pendingTasks = [];

  return async (...args) => {
    /** @type {worker.Worker} */
    let w;

    if (availableWorkers.size) {
      for (w of availableWorkers.keys()) {
        break;  // get 1st worker from map
      }
      const timeout = availableWorkers.get(w);
      availableWorkers.delete(w);
      clearTimeout(timeout);
    } else if (activeWorkers < options.tasks) {
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
  function terimateWorker(w) {
    --activeWorkers;
    w.terminate();
    availableWorkers.delete(w);
  }

  /**
   * @param {worker.Worker} w
   */
  function releaseWorker(w) {
    if (pendingTasks.length) {
      // There's an immediate task, consume it and go.
      const {args, resolve} = pendingTasks.shift();
      resolve(enact(w, args));
    } else if (options.expiry) {
      // Otherwise, put it into our queue to be deleted soon.
      const timeout = setTimeout(terimateWorker.bind(null, w), options.expiry);
      availableWorkers.set(w, timeout);
    } else {
      terimateWorker(w);
    }
  }
}
