/**
 * @fileoverview Runnable that invokes Worker.
 */

import worker from 'worker_threads';

const {parentPort} = worker;

if (worker.isMainThread || !parentPort) {
  throw new TypeError('cannot run on main thread');
}

const {dep} = worker.workerData;

import(dep)
  .then(({default: method}) => {
    parentPort.on('message', ({args, port}) => {
      Promise.resolve()
          .then(() => method(...args))
          .then((result) => port.postMessage({result}))
          .catch((error) => port.postMessage({error}))
          .then(() => port.close());
    });
    parentPort.postMessage({ok: true});
  })
  .catch((error) => {
    // Failure mode: the module couldn't be imported, complain loudly.
    parentPort.on('message', ({port}) => {
      port.postMessage({error});
      port.close();
    });
    parentPort.postMessage({ok: false});
    throw error;
  });
