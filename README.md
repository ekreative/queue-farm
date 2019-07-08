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

const worker = queueFarm.createWorker(async (queue, [job]) => {
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
    string, uses 127.0.0.1:6379 by default. The Redis connection should exclusive
    to Queue Farm, make a new connection if you need to use Redis for other purposes.
  * `deleteJobs` `<Bool>` Default is `true`, when false the job hash isn't deleted
    from Redis, useful for debugging, but you need to manually clear up your Redis
    database .
  * `timeout` `<Int>` Default is `30000`, default time (in milliseconds) to wait
    for a job to be completed before its counted as failed and should be retried.
  * `maxAttempts`, `<Int>` Default is `3`, number of times the job will be attempted
    before it is discarded. 
  * `id`, `<String>` Default is `'{os.hostname()}XXXX'`, where XXXX is 4 random digits.
    An id for the manager, useful to distinguish multiple running workers.
* Returns: `<queueFarm.Manager>`.
   
### Class `queueFarm.Manager`

#### Event: `'push'`

* `queue` `<String>` Name of the queue job.
* `jobId` `<String>` Id of job pushed.
* `job` `*` Data for the handler.
* `options` `<Object>`.

New job pushed.

#### Event: `'delete'`

* `queue` `<String>` Name of the queue job.
* `jobId` `<String>` Id of job pushed.
* `success` `<Bool>>` `true` if the job was deleted.

Job deleted.

#### `async manager.push(queue, job, [options])`

* `queue` `<String>` Name of the queue to push job to.
* `job` `*` Data for the handler, will be JSON encoded for storage.
* `options` `<Object>`
  * `maxAttempts`, `<Int>` Number of times the job will be attempted before it is
    discarded.
  * `timeout`, `<Int>` Time (in milliseconds) to wait for a job to be completed
    before its counted as failed and should be retried.
* Returns: `<String>` The jobs id.

Put a new job in a queue.

#### `async manager.del(queue, jobId)`

* `queue` `<String>` Name of the queue to delete the job from.
* `jobId` `<String>` The id returned from `push`.
* Returns: `<Bool>` `true` if the job was deleted, false if it was already performed.

Delete a job from the given queue.

### `queueFarm.createWorker([options], handler)`

* `options` `<Object>` Extends `queueFarm.createManager options`
  * `noActiveQueuesSleep` `<Int>` Default `30000`. Time (in milliseconds) to sleep
    when there are no active queues.
  * `allEmptySleep` `<Int>` Default `1000`. Time (in milliseconds) to sleep when
    all the queues are empty.
  * `checkEmptyIterations` `<Int>` Default is `50`, how many iterations to wait
    before clearing active jobs queue.
  * `concurrent` `<Int>` Default is `1`, how many jobs can be run concurrently.
  * `batchSize` `<Int>` Default is `1`, how many jobs to return in a batch.
* `handler` `async <Function>` Function that receives jobs to be processed.
  Args are `(queue, jobs)`, just the same as passed to `push`. If errors are throw
  the job will be retried, up to retry limit. 
* Returns: `<queueFarm.Worker>`.

### Class `queueFarm.Worker extends queueFarm.Manager`

#### Event: `'start'`

* `queue` `<String>` Name of the queue job is starting on.
* `jobIds` `[<String>]` Ids of jobs starting now.
* `jobs` `[*]` Datas of jobs starting now.

Started the job.

#### Event: `'finish'`

* `queue` `<String>` Name of the queue job is finished on.
* `jobIds` `[<String>]` Ids of jobs finished now.
* `jobs` `[*]` Datas of jobs starting now.

Finished handling job.

#### Event: `'handler-error'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobIds` `[<String>]` Ids of jobs that errored.
* `error` `*` The error thrown by the handler.
* `jobs` `[*]` Datas of jobs starting now.

Emitted when the handler throws an error.

#### Event: `'deleted-error'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobIds` `[<String>]` Ids of jobs that errored.
* `error` `Error` An error object .

Emitted when trying to run a deleted job.

#### Event: `'retry-limit'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobIds` `[<String>]` Ids of jobs that errored.
* `datas` `[<String>]` JSON encoded job datas.
* `error` `Error` An error object.

Emitted when a job retry limit is ready.

#### Event: `'invalid-data'`

* `queue` `<String>` Name of the queue job has errored on.
* `jobIds` `[<String>]` Ids of jobs that errored.
* `datas` `[<String>]` JSON encoded job datas.
* `error` `Error` An error object.

Emitted when trying to decode job data

#### Event: `'all-empty'`

Emitted when all active queues are empty, before sleep.

#### Event: `'no-active-queues'`

Emitted when there are no active queues, before sleep.

#### `async worker.listen()`

Start listening for jobs.

#### `async worker.stop()`

Stops listening for jobs. Prevents more jobs being taken off the queue, running
jobs will finish.

#### `async worker.drain`

Listens for jobs until all the queues are empty and then returns.

### `queueFarm.createLogger(manager, logger, [options])`

* `manager` `<queueFarm.Manager>`
* `logger` `<Logger>` | `<Console>`
* `options` `<Object>` Extends `queueFarm.createManager options`
  * `extended` `<Bool>` Default `false`. To include the extended meta in the logs.
  * `exceptEvents` `[<String>]`Names of events not to listen for. Defaults to
    `['all-empty', 'no-active-queues']`
* Returns: `<queueFarm.Logger>`.

### Class `queueFarm.Logger`

#### `logger.on()`

Start logging events.

#### `logger.off()`

Stop logging events.

## How it works

Redis keys used:

| Type   | Key                                        | Value       | Description                                                           |
|--------|--------------------------------------------|-------------|-----------------------------------------------------------------------|
| Set    | {namespace}:active                         | queue names | Used to track which queues exist.                                     |
| Hash   | {namespace}:job:{jobId}.queuedAt           | timestamp   | Time job was queued.                                                  |
| Hash   | {namespace}:job:{jobId}.data               | string      | Time job was queued.                                                  |
| Hash   | {namespace}:job:{jobId}.maxAttempts        | int         | Max times to attempt this job.                                        |
| Hash   | {namespace}:job:{jobId}.attempts           | int         | Times this job has been attempted.                                    |
| Hash   | {namespace}:job:{jobId}.attemptAt          | timestamp   | Last time this job was attempted.                                     |
| Hash   | {namespace}:job:{jobId}.timeout            | int         | Timeout (milliseconds) for this job.                                  |
| Hash   | {namespace}:job:{jobId}.deleteAt           | timestamp   | Time job was deleted.                                                 |
| Hash   | {namespace}:job:{jobId}.finishAt           | timestamp   | Time job was finished.                                                |
| Hash   | {namespace}:job:{jobId}.maxAttemptsAt      | timestamp   | Time job hit max attempts.                                            |
| Hash   | {namespace}:job:{jobId}.errorAt            | timestamp   | Time job has error.                                                   |
| Hash   | {namespace}:job:{jobId}.dataDeletedErrorAt | timestamp   | Time job has error because its data has been deleted since dequeuing. |
| Hash   | {namespace}:job:{jobId}.dataInvalidErrorAt | timestamp   | Time job has error because its data couldnt be decode from JSON.      |
| Hash   | {namespace}:job:{jobId}.workerId           | string      | Id of the worker handling this job.                                   |
| Hash   | {namespace}:job:{jobId}.managerId          | string      | Id of the manager that pushed this job.                               |
| List   | {namespace}:queue:{queue}                  | job ids     | List of jobs on the queue.                                            |
| String | {namespace}:active:{queue}:fetchAt         | timestamp   | Time job was taken from the queue, used to timeout the job.           |
| List   | {namespace}:active:{queue}                 | job ids     | List of active jobs for the queue.                                    |

Redis keys when adding a job:
- Start `MULTI`
- Add {queue} to {namespace}:active
- Update {namespace}:job:{jobId}.queuedAt
- Update {namespace}:job:{jobId}.data
- Update {namespace}:job:{jobId}.maxAttempts
- Update {namespace}:job:{jobId}.timeout
- Update {namespace}:job:{jobId}.managerId
- Add {jobId} to left of {namespace}:queue:{queue}
- `EXEC`

When deleting a job:
- Start `MULTI`
- Delete {namespace}:job:{jobId} or update {namespace}:job:{jobId}.deleteAt
- Delete {jobId} from {namespace}:queue:{queue}
- `EXEC`

When taking a job from the queue:
- Start a watch on {namespace}:active:{queue}
- If there is a job in {namespace}:active:{queue}
  - Stop watching {namespace}:active:{queue}
  - Check if it is stalled and run it
- Start `MULTI` - also fails if {namespace}:active:{queue} has changed
- Get {jobId} from right of {namespace}:queue:{queue} and add
  {jobId} to left of {namespace}:active:{queue} (`RPOPLPUSH`)
- Update {namespace}:active:{queue}:fetchAt
- `EXEC`

Check if job has stalled:
- Start a watch on {namespace}:active:{queue}:fetchAt
- Get {namespace}:active:{queue}:fetchAt and {namespace}:job:{jobId}.timeout
- If timeout is ok unwatch and do nothing
- Use `MULTI` to update `{namespace}:active:{queue}:fetchAt` - so fails if already
  updated

Handling a job:
- Get {namespace}:job:{jobId}
- Checks attempts, if its >= maxAttempts the job is deleted
- Start `MULTI`
- Update {namespace}:job:{jobId}.attempts
- Update {namespace}:job:{jobId}.attemptAt
- Update {namespace}:job:{jobId}.workerId
- `EXEC`
- Start handler

Job error:
- Start `MULTI`
- Add {jobId} to right of {namespace}:queue:{queue}
- Remove {jobId} from {namespace}:active:{queue}
- Update {namespace}:job:{jobId}.errorAt
- `EXEC`

Job complete:
- Start `MULTI`
- Delete {jobId} from {namespace}:active:{queue}
- Delete {namespace}:job:{jobId} or Update {namespace}:job:{jobId}.finishAt
- `EXEC`

Check for empty queue:
- Watch {namespace}:active:{queue} and {namespace}:queue:{queue}
- Get length of {namespace}:queue:{queue}
- Get length of {namespace}:active:{queue}
- If both are empty then start `MULTI`
- Delete {queue} from {namespace}:active
- Delete {namespace}:active:{queue}:fetchAt
- `EXEC`
