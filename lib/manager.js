const EventEmitter = require('events')
const Redis = require('ioredis')
const throwErrs = require('./throwErrs')
const uuidv4 = require('uuid/v4')

class Manager extends EventEmitter {
  constructor (options) {
    super()
    handleOptions.call(this, options)
  }

  async push (queue, job, options = {}) {
    const jobId = uuidv4()
    await this.redis
      .multi()
      .sadd(`${this.namespace}:active`, queue)
      .hset(`${this.namespace}:job:${jobId}`, 'queuedAt', Date.now())
      .hset(`${this.namespace}:job:${jobId}`, 'data', JSON.stringify(job))
      .hset(`${this.namespace}:job:${jobId}`, 'maxAttempts', options.maxAttempts || this.maxAttempts)
      .hset(`${this.namespace}:job:${jobId}`, 'timeout', options.timeout || this.timeout)
      .lpush(`${this.namespace}:queue:${queue}`, jobId)
      .exec()

    this.emit('push', queue, jobId, job, options)

    return jobId
  }

  async del (queue, jobId) {
    let pipeline = this.redis.multi()
    if (this.deleteJobs) {
      pipeline = pipeline.del(`${this.namespace}:job:${jobId}`)
    } else {
      pipeline = pipeline.hset(`${this.namespace}:job:${jobId}`, 'deleteAt', Date.now())
    }
    const [[errD], [errR, resultR]] = await pipeline
      .lrem(`${this.namespace}:queue:${queue}`, 1, jobId)
      .exec()

    throwErrs(errD, errR)
    return resultR > 0
  }
}

function handleOptions (options = {}) {
  this.namespace = options.namespace || 'queue-farm'
  this.maxAttempts = options.maxAttempts || 3
  this.timeout = options.timeout || 30000
  this.noActiveQueuesSleep = options.noActiveQueuesSleep || 30000
  this.allEmptySleep = options.allEmptySleep || 1000
  this.checkEmptyIterations = options.checkEmptyIterations || 50
  this.deleteJobs = options.deleteJobs !== undefined ? options.deleteJobs : true
  this.concurrent = options.concurrent || 1
  this.batchSize = options.batchSize || 1
  if (options.redis instanceof Redis) {
    this.redis = options.redis
  } else {
    this.redis = new Redis(options.redis)
  }
}

module.exports.Manager = Manager
module.exports.createManager = options => new Manager(options)
