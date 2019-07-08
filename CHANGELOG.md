# Changelog

### 2.2.1

- Change default manager `id`.

### 2.2.0

- Add `defaultMeta` option to logger.

### 2.1.1

- Rename logger option `includeJobs` to `extended`.

### 2.1.0

- Add `Logger` to make it easy to log everything happening in the queue.
- Timeout for batches is now the total timeout, not the max of the batch.
- Add worker ids to better track which worker is doing what.
- Add documentation of redis implementation.
- Add invalid data event for when JSON data cannot be parsed.
- Add more fields tracking when jobs are handled.

### 2.0.3

- Missing changelog.

### 2.0.2

- Remove :fetchAt keys from database on checkEmptyQueue.

### 2.0.1

- Missing changelog.

### 2.0.0

- Support for receiving jobs in batches.
- Changes the signiture of handler and event handlers.

### 1.0.3

- Renamed some options.
- More max attempts and timeout to be job specific (default can be set as well).
- Fix drain when no active queues.
- Add deleteJobs option to allow keeping jobs data in Redis.

### 1.0.2

- Move ioredis to peer dep.

### 0.0.0

- Starting out!
