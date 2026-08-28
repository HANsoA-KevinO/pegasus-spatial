import assert from 'node:assert/strict'
import { demoMongoRuntime, resolveDemoAppPort } from '../demo-local'

assert.equal(resolveDemoAppPort(undefined), 3200)
assert.equal(resolveDemoAppPort('3201'), 3201)
assert.throws(() => resolveDemoAppPort('80'), /1024/)
assert.throws(() => resolveDemoAppPort('not-a-port'), /整数/)

assert.equal(
  demoMongoRuntime('mongodb://127.0.0.1:27019/pegasus_spatial'),
  'docker',
)
assert.equal(
  demoMongoRuntime('mongodb://127.0.0.1:27017/pegasus_spatial'),
  'local',
)
assert.equal(
  demoMongoRuntime('mongodb://localhost/pegasus_spatial'),
  'local',
)

console.log('demo-local configuration verification passed')
