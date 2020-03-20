
/**
 * Runnable that invokes Worker.
 */

import worker from 'worker_threads';

if (worker.isMainThread) {
  throw new TypeError('cannot run on main thread');
}

const {dep} = worker.workerData;

const safeImport = async () => {
  try {
    return import(dep);
  } catch (e) {
    return require(dep);
  }
};

safeImport(dep).then(({default: method}) => {
  worker.parentPort.on('message', ({task, port}) => {
    Promise.resolve()
        .then(() => method(task))
        .then((result) => port.postMessage({result}))
        .catch((error) => port.postMessage({error}))
        .then(() => port.close());
  });
}).catch((error) => {
  // Failure mode: the module couldn't be imported, complain loudly.
  worker.parentPort.on('message', ({port}) => {
    port.postMessage({error});
    port.close();
  });
});
