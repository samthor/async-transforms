
import worker from 'worker_threads';
import path from 'path';
import os from 'os';

/**
 * Determines the absolute directory where this script is contained.
 */
function scriptDir() {
  try {
    const absolutePath = String(import.meta.url).replace(/^file:\/\//, '');
    return path.dirname(absolutePath);
  } catch (e) {
    // try __dirname
  }
  try {
    return __dirname;
  } catch (e) {
    throw new Error(`could not resolve __dirname or import.meta.url`);
  }
}

const cpuCount = os.cpus().length || 4;
const workerTarget = path.join(scriptDir(), './internal-worker.js');

export function pool(dep, options) {
  options = Object.assign({
    tasks: cpuCount * 0.75,
    expiry: 1000,
  }, options);

  options.expiry = Math.max(options.task, 0) || 0;
  options.tasks = Math.max(Math.ceil(options.tasks), 0) || 1;

  if (!path.isAbsolute(dep)) {
    throw new TypeError(`cannot load worker with relative path: ${dep}`);
  }

  let activeWorkers = 0;
  const availableWorkers = new Map();
  const pendingTasks = [];

  return async (task) => {
    let w;

    if (availableWorkers.size) {
      for (w of availableWorkers.keys()) {
        break;  // get 1st worker from map
      }
      const timeout = availableWorkers.get(w);
      availableWorkers.delete(w);
      clearTimeout(timeout);
    } else if (activeWorkers < options.tasks) {
      w = new worker.Worker(workerTarget, {workerData: {dep}});
      ++activeWorkers;
    } else {
      return new Promise((resolve) => {
        pendingTasks.push({task, resolve});
      });
    }

    return enact(w, task);
  };

  function enact(w, task) {
    // While we could use the worker's parentPort, this gives us less risk of crosstalk.
    const {port1, port2} = new worker.MessageChannel();
    w.postMessage({task, port: port2}, [port2]);

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

  function terimateWorker(w) {
    --activeWorkers;
    w.terminate();
    availableWorkers.delete(w);
  }

  function releaseWorker(w) {
    if (pendingTasks.length) {
      // There's an immediate task, consume it and go.
      const {task, resolve} = pendingTasks.shift();
      resolve(enact(w, task));
    } else if (options.expiry) {
      // Otherwise, put it into our queue to be deleted soon.
      const timeout = setTimeout(terimateWorker.bind(null, w), options.expiry);
      availableWorkers.set(w, timeout);
    } else {
      terimateWorker(w)
    }
  }
}
