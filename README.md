# Queue farm

Queue farm is a job queue that executes in order, backed by redis

[![Build Status](https://travis-ci.org/ekreative/queue-farm.svg?branch=master)](https://travis-ci.org/ekreative/queue-farm)

## Creating jobs

Use the manager and push new jobs to it

```javascript
const queueFarm = require('queue-farm')

const manager = queueFarm.createManager()
manager.push('queue-name', {some: 'task'})
manager.push('another-queue-name', {some: 'task'})
```

Each named queue is executed in order, but different queues will be run out of order

## Running jobs

```javascript
const queueFarm = require('queue-farm')

const worker = queueFarm.createWorker((queue, job) => {
  console.log(`Handle a job from ${queue}`, job)  
})
worker.listen()
```

The worker will run indefinatly by default, call `drain` to run whilst there are still
jobs visible
 
## API

### `queueFarm.createManager([options])`

* `options` `<Object>`
  * `namespace` `<String>` Default is 'queue-farm', used to run different instances on the same Redis server
  * `redis` Either a [Redis](https://github.com/luin/ioredis) instance or connection string,
     uses 127.0.0.1:6379 by default
* Returns: `<queueFarm.Manager>`
   
### Class `queueFarm.Manager`

#### `async manager.push(queue, job)`

* `queue` `<String>`
* `job` `*`
* Returns: `<String>` the jobs id

Put a new job in a queue

#### `async manager.del(queue, jobId)`

* `queue` `<String>`
* `jobId` `<String>`

Delete a job from the given queue

### `queueFarm.createWorker([options], handler)`

* `options` `<Object>`
  * `namespace` `<String>` Default is 'queue-farm', used to run different instances on the same Redis server
  * `redis` Either a [Redis](https://github.com/luin/ioredis) instance or connection string,
     uses 127.0.0.1:6379 by default
  * `retryLimit` `<Int>` Default is 3
  * `noActiveQueuesSleep` `<Int>` Default 30000
  * `allEmptySleep` `<Int>` Default 1000
* `handler` `async <Function>` Function that receives jobs to be processed. Args are `(queue, job)`,
  just the same as passed to `push`. If errors are throw the job will be retried, up to retry limit 
  
* Returns: `<queueFarm.Worker>`
   
### Class `queueFarm.Worker`

#### Event: `'start'`

* `queue` `<String>`
* `jobId` `<String>`

Started the job

#### Event: `'finish'`

* `queue` `<String>`
* `jobId` `<String>`

Finished handling job

#### Event: `'handler-error'`

* `queue` `<String>`
* `jobId` `<String>`
* `err` `*` The error thrown by the handler

Emitted when the handler throws an error

#### Event: `'retry-limit'`

* `queue` `<String>`
* `jobId` `<String>`
* `job` `*` The actual job data

Emitted when a job retry limit is ready

#### Event: `'all-empty'`

Emitted when all active queues are empty, before sleep

#### Event: `'no-active-queues'`

Emitted when there are no active queues, before sleep

#### `async worker.listen()`

Start listening for jobs

#### `async worker.stop()`

Stops listening for jobs

#### `async worker.drain`

Listens for jobs until all the queues are empty and then returns
