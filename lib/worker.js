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
        const [empty, jobIds] = await getJobsFromQueue.call(this, queue)
        if (jobIds && jobIds.length) {
          await this.limiter.push(async () => {
            await handleJobs.call(this, queue, jobIds)
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

async function handleJobs (queue, jobIdsToHandle) {
  let cmd = this.redis.pipeline()
  for (let jobId of jobIdsToHandle) {
    cmd = cmd.hgetall(`${this.namespace}:job:${jobId}`)
  }
  const results = await cmd.exec()

  let cleanUpJobs = []
  let jobIds = []
  let jobDatas = []
  let deletedErrors = []
  let retryLimits = []

  for (let i = 0; i < jobIdsToHandle.length; i++) {
    const jobId = jobIdsToHandle[i]
    const [err, jobState] = results[i]

    if (err || !jobState.data) {
      cleanUpJobs.push([jobId, 'error'])
      deletedErrors.push(jobId)
      continue
    }

    if ((jobState.attempts || 0) >= (jobState.maxAttempts || this.maxAttempts)) {
      cleanUpJobs.push([jobId, 'maxAttempts'])
      retryLimits.push([jobId, jobState.data])
      continue
    }
    jobIds.push(jobId)
    jobDatas.push(jobState.data)
  }

  if (deletedErrors.length) {
    this.emit('deleted-error', queue, deletedErrors, new Error('Job already removed'))
  }

  if (retryLimits.length) {
    this.emit('retry-limit', queue, retryLimits)
  }

  if (cleanUpJobs.length) {
    await cleanUpActiveJobs.call(this, queue, cleanUpJobs)
  }

  if (!jobIds.length) {
    return
  }

  await this.redisAccess.push(async () => {
    let cmd = this.redis.multi()
    for (let jobId of jobIds) {
      cmd = cmd.hincrby(`${this.namespace}:job:${jobId}`, 'attempts', 1)
        .hset(`${this.namespace}:job:${jobId}`, 'attemptAt', Date.now())
    }
    await cmd.exec()
  })

  this.emit('start', queue, jobIds)
  try {
    await this.handler(queue, jobDatas.map(data => JSON.parse(data)))
  } catch (err) {
    await this.redisAccess.push(async () => {
      let cmd = this.redis.multi()
      for (let jobId of jobIds) {
        cmd = cmd.lrem(`${this.namespace}:active:${queue}`, 1, jobId)
      }
      cmd = cmd.rpush(`${this.namespace}:queue:${queue}`, ...[...jobIds].reverse())
      await cmd.exec()
    })
    this.emit('handler-error', queue, jobIds, err)
    return
  }
  await cleanUpActiveJobs.call(this, queue, jobIds.map(jobId => [jobId, 'finish']))
  this.emit('finish', queue, jobIds)
}

async function cleanUpActiveJobs (queue, jobs) {
  return this.redisAccess.push(async () => {
    let pipeline = this.redis.multi()
    for (let [jobId, field] of jobs) {
      if (this.deleteJobs) {
        pipeline = pipeline.del(`${this.namespace}:job:${jobId}`)
      } else {
        pipeline = pipeline
          .hset(`${this.namespace}:job:${jobId}`, `${field}At`, Date.now())
          .rpush(`${this.namespace}:${field}:${queue}`, jobId)
      }
      pipeline = pipeline.lrem(`${this.namespace}:active:${queue}`, 1, jobId)
    }
    await pipeline.exec()
  })
}

async function getJobsFromQueue (queue) {
  return this.redisAccess.push(async () => {
    await this.redis.watch(`${this.namespace}:active:${queue}`)
    const activeJobIds = await this.redis.lrange(`${this.namespace}:active:${queue}`, 0, -1)
    if (activeJobIds.length) {
      await this.redis.unwatch()
      if (await shouldHandleActive.call(this, queue, activeJobIds)) {
        return [false, activeJobIds]
      }
      return [false]
    }

    let cmd = this.redis.multi()
    for (let i = 0; i < this.batchSize; i++) {
      cmd = cmd.rpoplpush(`${this.namespace}:queue:${queue}`, `${this.namespace}:active:${queue}`)
    }
    cmd = cmd.set(`${this.namespace}:active:${queue}:fetchAt`, Date.now())

    const results = await cmd.exec()
    if (results === null) {
      return [false]
    }
    const [errS] = results.pop()
    throwErrs(errS)

    let jobIds = []; let errs = []
    for (let [err, jobId] of results) {
      errs.push(err)
      if (jobId) {
        jobIds.push(jobId)
      }
    }
    throwErrs(...errs)

    return [jobIds.length === 0, jobIds]
  })
}

async function shouldHandleActive (queue, jobIds) {
  await this.redis.watch(`${this.namespace}:active:${queue}:fetchAt`)

  let cmd = this.redis.pipeline()
  for (let jobId of jobIds) {
    cmd = cmd.hget(`${this.namespace}:job:${jobId}`, 'timeout')
  }
  const results = await cmd
    .get(`${this.namespace}:active:${queue}:fetchAt`)
    .exec()

  const [errF, fetchAt] = results.pop()
  throwErrs(errF)

  let maxTimeout = 0

  for (let [errT, timeout] of results) {
    throwErrs(errT)
    if (timeout > maxTimeout) {
      maxTimeout = timeout
    }
  }

  const now = Date.now()
  if (fetchAt && now - Number(fetchAt) < (maxTimeout || this.timeout)) {
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
        .del(`${this.namespace}:active:${queue}:fetchAt`)
        .exec()
    } else {
      await this.redis.unwatch()
    }
  })
}

module.exports.Worker = Worker
module.exports.createWorker = (options, handler) => new Worker(options, handler)
