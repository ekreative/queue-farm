const EventEmitter = require('events')
const Redis = require('ioredis')
const sleep = require('./sleep')

class Worker extends EventEmitter {
  constructor (options, handler) {
    super()
    if (handler === null) {
      handler = options
      options = {}
    }

    this.namespace = options.namespace || 'queue-farm'
    this.retryLimit = options.retryLimit || 3
    this.noActiveQueuesSleep = options.noActiveQueuesSleep || 30000
    this.allEmptySleep = options.allEmptySleep || 1000
    this.checkEmptyIterations = options.checkEmptyIterations || 50
    if (options.redis instanceof Redis) {
      this.redis = options.redis
    } else {
      this.redis = new Redis(options.redis)
    }

    this.handler = handler
    this.runStarted = false
  }

  async listen () {
    this.running = true
    if (this.runStarted) {
      return
    }
    this.runStarted = true
    let iterations = 0
    while (this.running) {
      const activeQueues = await this.redis.smembers(`${this.namespace}:active`)
      if (activeQueues.length === 0) {
        this.emit('no-active-queues')
        if (this.running) {
          await sleep(30000)
        }
        continue
      }

      let emptyQueues = []
      for (let queue of activeQueues) {
        const jobId = await getJobFromQueue.call(this, queue)
        if (jobId) {
          await handleJob.call(this, queue, jobId)
        } else {
          emptyQueues.push(queue)
        }

        if (!this.running) {
          break
        }
      }

      if (!this.running) {
        break
      }

      if (iterations++ > this.checkEmptyIterations) {
        iterations = 0

        for (let queue of emptyQueues) {
          await checkEmptyQueue.call(this, queue)
        }
      }

      if (emptyQueues.length === activeQueues.length) {
        this.emit('all-empty')
        if (this.running) {
          await sleep(1000)
        }
      }
    }
    this.runStarted = false
  }

  stop () {
    this.running = false
  }

  drain () {
    return new Promise((resolve, reject) => {
      this.listen()
        .then(resolve)
        .catch(reject)

      this.once('all-empty', () => {
        this.stop()
      })
    })
  }
}

async function handleJob (queue, jobId) {
  const jobState = await this.redis.hgetall(`${this.namespace}:job:${jobId}`)
  if (!jobState.data) {
    await cleanUpActiveJob.call(this, queue, jobId)
    this.emit('error', queue, jobId, new Error('Job already removed'))
    return
  }

  if ((jobState.attempts || 0) >= this.retryLimit) {
    await cleanUpActiveJob.call(this, queue, jobId)
    this.emit('retry-limit', queue, jobId, jobState.data)
    return
  }

  await this.redis
    .multi()
    .hincrby(`${this.namespace}:job:${jobId}`, 'attempts', 1)
    .hset(`${this.namespace}:job:${jobId}`, 'attemptedAt', Date.now())
    .exec()

  const data = JSON.parse(jobState.data)
  this.emit('start', queue, jobId)
  try {
    await this.handler(queue, data)
  } catch (err) {
    await this.redis
      .multi()
      .lrem(`${this.namespace}:active:${queue}`, 1, jobId)
      .rpush(`${this.namespace}:queue:${queue}`, jobId)
      .exec()
    this.emit('handler-error', queue, jobId, err)
    return
  }
  await cleanUpActiveJob.call(this, queue, jobId)
  this.emit('finish', queue, jobId)
}

async function cleanUpActiveJob (queue, jobId) {
  await this.redis
    .multi()
    .lrem(`${this.namespace}:active:${queue}`, 1, jobId)
    .del(`${this.namespace}:job:${jobId}`)
    .exec()
}

async function getJobFromQueue (queue) {
  await this.redis.watch(`${this.namespace}:active:${queue}`)
  const activeJobId = await this.redis.lindex(`${this.namespace}:active:${queue}`, 0)
  if (activeJobId !== null) {
    await this.redis.unwatch()
    if (await shouldHandleActive.call(this, queue, activeJobId)) {
      return activeJobId
    }
    return
  }
  const result = await this.redis
    .multi()
    .rpoplpush(`${this.namespace}:queue:${queue}`, `${this.namespace}:active:${queue}`)
    .set(`${this.namespace}:active:${queue}:fetchedAt`, Date.now())
    .exec()
  if (result === null) {
    return
  }
  const [err, jobId] = result[0]
  if (err) {
    throw err
  }
  return jobId
}

async function shouldHandleActive (queue, jobId) {
  const [[errA, attemptedAt], [errF, fetchedAt]] = await this.redis
    .multi()
    .hget(`${this.namespace}:job:${jobId}`, 'attemptedAt')
    .get(`${this.namespace}:active:${queue}:fetchedAt`)
    .exec()

  if (errA) {
    throw errA
  }
  if (errF) {
    throw errF
  }

  const now = Date.now()
  if (attemptedAt) {
    return now - attemptedAt > 30000
  } else if (fetchedAt) {
    return now - fetchedAt > 30000
  } else {
    return true
  }
}

async function checkEmptyQueue (queue) {
  await this.redis.watch(`${this.namespace}:queue:${queue}`, `${this.namespace}:active:${queue}`)
  const [[errQ, queueLength], [errA, activeLength]] = await this.redis
    .pipeline()
    .llen(`${this.namespace}:queue:${queue}`)
    .llen(`${this.namespace}:active:${queue}`)
    .exec()

  if (errQ) {
    throw errQ
  }
  if (errA) {
    throw errA
  }

  if (queueLength === 0 && activeLength === 0) {
    await this.redis
      .multi()
      .srem(`${this.namespace}:active`, queue)
      .exec()
  } else {
    await this.redis.unwatch()
  }
}

module.exports.Worker = Worker
module.exports.createWorker = (options, handler) => new Worker(options, handler)
