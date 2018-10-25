const Redis = require('ioredis')
const uuidv4 = require('uuid/v4')

class Manager {
  constructor (options = {}) {
    this.namespace = options.namespace || 'queue-farm'

    if (options.redis instanceof Redis) {
      this.redis = options.redis
    } else {
      this.redis = new Redis(options.redis)
    }
  }
  async push (queue, job) {
    const id = uuidv4()
    await this.redis
      .multi()
      .sadd(`${this.namespace}:active`, queue)
      .hset(`${this.namespace}:job:${id}`, 'queuedAt', Date.now())
      .hset(`${this.namespace}:job:${id}`, 'data', JSON.stringify(job))
      .lpush(`${this.namespace}:queue:${queue}`, id)
      .exec()

    return id
  }
  async del (queue, id) {
    await this.redis
      .multi()
      .del(`${this.namespace}:job:${id}`)
      .lrem(`${this.namespace}:queue:${queue}`, 1, id)
      .exec()
  }
}

module.exports.Manager = Manager
module.exports.createManager = (options) => new Manager(options)
