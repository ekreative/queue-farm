# Queue farm

Queue farm is a job queue that executes in order, backed by redis.

[![Build Status](https://travis-ci.org/ekreative/queue-farm.svg?branch=master)](https://travis-ci.org/ekreative/queue-farm)

## Creating jobs

Use the manager and push new jobs to it.

```javascript
const queueFarm = require('queue-farm')

const manager = queueFarm.createManager()
manager.push('queue-name', {some: 'task'})
manager.push('another-queue-name', {some: 'task'})
```

Each named queue is executed in order, but different queues will be run out of order.

## Running jobs

```javascript
const queueFarm = require('queue-farm')

const worker = queueFarm.createWorker(async (queue, job) => {
  console.log(`Handle a job from ${queue}`, job)  
})
worker.listen()
```

The worker will run indefinitely by default, call `drain` to run whilst there are
still jobs visible.
 
## API

### `queueFarm.createManager([options])`

* `options` `<Object>`
  * `namespace` `<String>` Default is `'queue-farm'`, used to run different instances
    on the same Redis server.
  * `redis` Either a [Redis](https://github.com/luin/ioredis) instance or connection
    string, uses 127.0.0.1:6379 by default.
  * `deleteJobs` `<Bool>` Default is `true`, when false the job hash isn't deleted
    from Redis, useful for debugging, but you need to manually clear up your Redis
    database .
  * `timeout` `<Int>` Default is `30000`, default time to wait for a job to be completed
     before its counted as failed and should be retried.
  * `maxAttempts`, `<Int>` Default is `3`, number of times the job will be attempted
    before it is discarded. 
* Returns: `<queueFarm.Manager>`.
   
### Class `queueFarm.Manager`

#### Event: `'push'`

* `queue` `<String>` Name of the queue job.
* `jobId` `<String>` Id of job pushed.
* `job` `*` Data for the handler.
* `options` `<Object>`.

New job pushed.

#### `async manager.push(queue, job, [options])`

* `queue` `<String>` Name of the queue to push job to.
* `job` `*` Data for the handler, will be JSON encoded for storage.
* `options` `<Object>`
  * `maxAttempts`, `<Int>` Number of times the job will be attempted before it is
    discarded.
  * `timeout`, `<Int>` Time to wait for a job to be completed before its counted
    as failed and should be retried.
* Returns: `<String>` The jobs id.

Put a new job in a queue.

#### `async manager.del(queue, jobId)`

* `queue` `<String>` Name of the queue to delete the job from.
* `jobId` `<String>` The id returned from `push`.
* Returns: `<Bool>` `true` if the job was deleted, false if it was already performed.

Delete a job from the given queue.

### `queueFarm.createWorker([options], handler)`

* `options` `<Object>` Extends `queueFarm.createManager options`
  * `noActiveQueuesSleep` `<Int>` Default `30000`.
  * `allEmptySleep` `<Int>` Default `1000`.
  * `checkEmptyIterations` `<Int>` Default is `50`, how many iterations to wait
    before clearing active jobs queue.
  * `concurrent` `<Int>` Default is `1`, how many jobs can be run concurrently.
* `handler` `async <Function>` Function that receives jobs to be processed.
  Args are `(queue, job)`, just the same as passed to `push`. If errors are throw
  the job will be retried, up to retry limit. 
* Returns: `<queueFarm.Worker>`.
   
### Class `queueFarm.Worker extends queueFarm.Manager`

#### Event: `'start'`

* `queue` `<String>` Name of the queue job is starting on.
* `jobId` `<String>` Id of job starting now.

Started the job.

#### Event: `'finish'`

* `queue` `<String>` Name of the queue job is finished on.
* `jobId` `<String>` Id of job finished now.

Finished handling job.

#### Event: `'error'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobId` `<String>` Id of job that errored.
* `err` `*` The error thrown by the handler.

Emitted when the handler throws an error.

#### Event: `'retry-limit'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobId` `<String>` Id of job that errored.
* `job` `*` The job data.

Emitted when a job retry limit is ready.

#### Event: `'deleted-error'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobId` `<String>` Id of job that errored.

Emitted when when trying to run a deleted job.

#### Event: `'all-empty'`

Emitted when all active queues are empty, before sleep.

#### Event: `'no-active-queues'`

Emitted when there are no active queues, before sleep.

#### `async worker.listen()`

Start listening for jobs.

#### `async worker.stop()`

Stops listening for jobs.

#### `async worker.drain`

Listens for jobs until all the queues are empty and then returns.
