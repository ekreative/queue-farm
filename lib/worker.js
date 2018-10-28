const Manager = require('./manager').Manager
const sleep = require('./sleep')
const throwErrs = require('./throwErrs')
const limiter = require('./limiter')

class Worker extends Manager {
  constructor (options, handler) {
    if (typeof options === 'function') {
      handler = options
      options = {}
    }
    super(options)
    this.handler = handler
    this.runStarted = false
    this.limiter = limiter.createLimiter(this.concurrent)
    this.redisAccess = limiter.createLimiter(1)
    this.redisAccess.name = 'redisAccess'
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
          await sleep(this.noActiveQueuesSleep)
        }
        continue
      }

      let emptyQueues = []
      let busyQueues = []
      for (let queue of activeQueues) {
        const result = await getJobFromQueue.call(this, queue)
        const [empty, jobId] = result
        if (jobId) {
          await this.limiter.push(async () => {
            await handleJob.call(this, queue, jobId)
          })
        } else if (empty) {
          emptyQueues.push(queue)
        } else {
          busyQueues.push(queue)
        }

        if (!this.running) {
          break
        }
      }

      if (!this.running) {
        break
      }

      if (++iterations >= this.checkEmptyIterations) {
        iterations = 0

        for (let queue of emptyQueues) {
          await checkEmptyQueue.call(this, queue)
        }
      }

      if (emptyQueues.length === activeQueues.length) {
        this.emit('all-empty')
      }

      if (this.running && emptyQueues.length + busyQueues.length === activeQueues.length) {
        await sleep(this.allEmptySleep)
      }
    }
    this.runStarted = false
  }

  stop () {
    this.running = false
  }

  drain () {
    let handler = () => {
      this.stop()
      this.off('all-empty', handler)
      this.off('no-active-queues', handler)
    }

    this.on('all-empty', handler)
    this.on('no-active-queues', handler)
    return this.listen()
      .then(() => {
        return this.limiter.drain()
      })
  }
}

async function handleJob (queue, jobId) {
  const jobState = await this.redis.hgetall(`${this.namespace}:job:${jobId}`)
  if (!jobState.data) {
    await cleanUpActiveJob.call(this, queue, jobId, 'error')
    this.emit('deleted-error', queue, jobId, new Error('Job already removed'))
    return
  }

  if ((jobState.attempts || 0) >= (jobState.maxAttempts || this.maxAttempts)) {
    await cleanUpActiveJob.call(this, queue, jobId, 'maxAttempts')
    this.emit('retry-limit', queue, jobId, jobState.data)
    return
  }

  await this.redisAccess.push(async () => {
    await this.redis
      .multi()
      .hincrby(`${this.namespace}:job:${jobId}`, 'attempts', 1)
      .hset(`${this.namespace}:job:${jobId}`, 'attemptAt', Date.now())
      .exec()
  })

  const data = JSON.parse(jobState.data)
  this.emit('start', queue, jobId)
  try {
    await this.handler(queue, data)
  } catch (err) {
    await this.redisAccess.push(async () => {
      await this.redis
        .multi()
        .lrem(`${this.namespace}:active:${queue}`, 1, jobId)
        .rpush(`${this.namespace}:queue:${queue}`, jobId)
        .exec()
    })
    this.emit('handler-error', queue, jobId, err)
    return
  }
  await cleanUpActiveJob.call(this, queue, jobId, 'finish')
  this.emit('finish', queue, jobId)
}

async function cleanUpActiveJob (queue, jobId, field) {
  return this.redisAccess.push(async () => {
    let pipeline = this.redis.multi()
    if (this.deleteJobs) {
      pipeline = pipeline.del(`${this.namespace}:job:${jobId}`)
    } else {
      pipeline = pipeline
        .hset(`${this.namespace}:job:${jobId}`, `${field}At`, Date.now())
        .rpush(`${this.namespace}:${field}:${queue}`, jobId)
    }
    await pipeline
      .lrem(`${this.namespace}:active:${queue}`, 1, jobId)
      .exec()
  })
}

async function getJobFromQueue (queue) {
  return this.redisAccess.push(async () => {
    await this.redis.watch(`${this.namespace}:active:${queue}`)
    const activeJobId = await this.redis.lindex(`${this.namespace}:active:${queue}`, 0)
    if (activeJobId !== null) {
      await this.redis.unwatch()
      if (await shouldHandleActive.call(this, queue, activeJobId)) {
        return [false, activeJobId]
      }
      return [false]
    }
    const result = await this.redis
      .multi()
      .rpoplpush(`${this.namespace}:queue:${queue}`, `${this.namespace}:active:${queue}`)
      .set(`${this.namespace}:active:${queue}:fetchAt`, Date.now())
      .exec()
    if (result === null) {
      return [false]
    }
    const [[errP, jobId], [errS]] = result
    throwErrs(errP, errS)

    return [jobId === null, jobId]
  })
}

async function shouldHandleActive (queue, jobId) {
  await this.redis.watch(`${this.namespace}:active:${queue}:fetchAt`)

  const [[errT, timeout], [errF, fetchAt]] = await this.redis
    .pipeline()
    .hget(`${this.namespace}:job:${jobId}`, 'timeout')
    .get(`${this.namespace}:active:${queue}:fetchAt`)
    .exec()

  throwErrs(errT, errF)

  const now = Date.now()
  if (fetchAt && now - Number(fetchAt) < (timeout || this.timeout)) {
    await this.redis.unwatch()
    return false
  }

  const result = await this.redis
    .multi()
    .set(`${this.namespace}:active:${queue}:fetchAt`, Date.now())
    .exec()

  return result !== null
}

async function checkEmptyQueue (queue) {
  return this.redisAccess.push(async () => {
    await this.redis.watch(`${this.namespace}:queue:${queue}`, `${this.namespace}:active:${queue}`)
    const [[errQ, queueLength], [errA, activeLength]] = await this.redis
      .pipeline()
      .llen(`${this.namespace}:queue:${queue}`)
      .llen(`${this.namespace}:active:${queue}`)
      .exec()

    throwErrs(errQ, errA)

    if (queueLength === 0 && activeLength === 0) {
      await this.redis
        .multi()
        .srem(`${this.namespace}:active`, queue)
        .exec()
    } else {
      await this.redis.unwatch()
    }
  })
}

module.exports.Worker = Worker
module.exports.createWorker = (options, handler) => new Worker(options, handler)
