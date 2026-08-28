import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyCompactionPresentationToParts,
  compactionPresentation,
  contextUsageFromTokenEvent,
} from '../../../hooks/chat-compaction-state'
import {
  canAcceptQueuedUserInput,
  routeChatSubmission,
  type ChatSubmissionTransport,
} from '../../../lib/chat/submission-routing'
import { resolveRunIdentityEvent } from '../../../lib/chat/run-identity-fence'

const useChatSource = readFileSync(
  join(process.cwd(), 'hooks', 'useChat.ts'),
  'utf8',
)
const routeSource = readFileSync(
  join(process.cwd(), 'app', 'api', 'chat', 'route.ts'),
  'utf8',
)
const interruptRouteSource = readFileSync(
  join(process.cwd(), 'app', 'api', 'chat', 'interrupt', 'route.ts'),
  'utf8',
)
const messageBubbleSource = readFileSync(
  join(process.cwd(), 'components', 'chat', 'MessageBubble.tsx'),
  'utf8',
)
const runStreamSource = readFileSync(
  join(process.cwd(), 'app', 'api', 'chat', 'runs', '[runId]', 'stream', 'route.ts'),
  'utf8',
)
const compactionStatusRouteSource = readFileSync(
  join(process.cwd(), 'app', 'api', 'conversations', '[id]', 'compaction', 'route.ts'),
  'utf8',
)
const chatInputSource = readFileSync(
  join(process.cwd(), 'components', 'chat', 'ChatInput.tsx'),
  'utf8',
)

assert.match(
  useChatSource,
  /\.\.\.\(conversationId \? \{ conversation_id: conversationId \} : \{\}\)/,
  'new projects must omit conversation_id instead of serializing null',
)

assert.equal(
  contextUsageFromTokenEvent({ total_input_tokens: 185_000, overhead_tokens: 5_000 }),
  null,
  'a token event without server capacity must hide the gauge, not invent 200K',
)
assert.deepEqual(contextUsageFromTokenEvent({
  total_input_tokens: 90_000,
  overhead_tokens: 10_000,
  context_window: 128_000,
  max_output_tokens: 16_000,
}), {
  compressible: 80_000,
  threshold: 112_000,
})
for (const status of ['queued', 'summarizing', 'summary_ready', 'merge_prepared', 'retryable', 'failed', 'cancelled', 'superseded'] as const) {
  assert.notEqual(
    compactionPresentation(status).action,
    '上下文压缩完成',
    `${status} must never render as successful completion`,
  )
}
assert.equal(compactionPresentation('merged').action, '上下文压缩完成')
const once = applyCompactionPresentationToParts([], 'queued')
const twice = applyCompactionPresentationToParts(once, 'summarizing')
assert.equal(twice.length, 1, 'same Job state progression updates one row instead of duplicating it')
assert.equal(twice[0].type === 'tool_call' && twice[0].action, '正在生成上下文摘要…')

assert.doesNotMatch(
  useChatSource,
  /200_000\s*-\s*overhead/,
  'client context capacity must not be hard-coded',
)
assert.match(useChatSource, /contextUsage\?: ContextUsageState \| null/)
assert.match(useChatSource, /setContextUsage\(cached\.contextUsage \?\? null\)/)
assert.match(useChatSource, /compactionPollsRef = useRef\(new Map<string, AbortController>\(\)\)/)
assert.match(useChatSource, /setTimeout\(resolve, 2_000\)/)
assert.match(useChatSource, /status === 'merged'\) setScopedContextUsage\(myKey, null\)/)
assert.match(useChatSource, /evtType === 'compaction_done'[\s\S]{0,120}setScopedContextUsage\(myKey, null\)/)
assert.match(runStreamSource, /type: 'compaction_status'/)
assert.match(runStreamSource, /compactionKey !== lastCompactionKey/)
assert.match(runStreamSource, /observedRunStatus !== 'running'/)
assert.match(compactionStatusRouteSource, /owner_kind: 'conversation'/)
assert.match(compactionStatusRouteSource, /Conversation\.exists\(\{ conversation_id: id, user_id: userId \}\)/)
assert.doesNotMatch(compactionStatusRouteSource, /getConversation\(/)
assert.doesNotMatch(
  compactionStatusRouteSource,
  /\.select\([^)]*(messages|compacted_messages|output)/,
  '2s status polling must never hydrate the large Conversation payload',
)
assert.doesNotMatch(compactionStatusRouteSource, /frozen_prefix|summary:/)
assert.match(compactionStatusRouteSource, /model_resolution_snapshot/)
assert.match(compactionStatusRouteSource, /resolvePublicCompactionCapacity\(job, getAliasCapabilities\)/)
assert.match(runStreamSource, /model_resolution_snapshot/)
assert.match(runStreamSource, /resolvePublicCompactionCapacity\(job, getAliasCapabilities\)/)
assert.match(routeSource, /context_window: modelCapabilities\.contextWindow/)
assert.match(routeSource, /input_limit_tokens: Math\.max/)
assert.match(routeSource, /max_output_tokens: modelCapabilities\.maxOutputTokens/)
assert.match(chatInputSource, /PEGASUS SPATIAL · \{APP_VERSION\}/)
assert.match(chatInputSource, /className="px-4 pb-2 pt-2"/)
assert.doesNotMatch(chatInputSource, /Press|for commands|CONTEXT —|pmo-kbd|pmo-tokens/)
assert.match(
  routeSource,
  /const conversation_id = rawConversationId \?\? undefined/,
  'the API must tolerate legacy null conversation identities',
)

assert.match(
  messageBubbleSource,
  /parts\.length === 0 && \(isStreaming \|\| message\.content\.trim\(\)\.length > 0\)/,
  'pre-SSE waiting and content-only error states must enter FinalResponse',
)

assert.ok(
  useChatSource.indexOf('void consumeReconnectStream(myKey, detachedRunId)')
    < useChatSource.indexOf('const res = await fetch(`/api/conversations/${myKey}`)'),
  'Runner reconnect must start before secondary artifact hydration',
)
assert.match(
  messageBubbleSource,
  /\{shouldRenderFinal && \(/,
  'assistant rendering must use the empty-parts fallback',
)

assert.match(useChatSource, /routeChatSubmission(?:<[^>]+>)?\(initialTransport/)
assert.match(useChatSource, /cached\.messages = \[[\s\S]{0,100}userMsg/)
assert.match(
  useChatSource,
  /abortsRef\.current\.get\(myKey\) === controllerToClean/,
  'an older transport finally must not delete a newer controller',
)
assert.match(interruptRouteSource, /canAcceptQueuedUserInput\(activeRun\)/)
assert.match(interruptRouteSource, /canAcceptQueuedUserInput\(latestActiveRun\)/)
assert.match(
  routeSource,
  /async function ensureQueuedPublicContinuation[\s\S]{0,500}!isPublicRootAgentRun\(sourceRun\)[\s\S]{0,160}!isAgentRunnerEnabled\(\)[\s\S]{0,300}reserveNextPublicUserMessageForRun\(/,
  'continuation scheduling must atomically reserve public Root input while the Runner is enabled',
)
assert.ok(
  (routeSource.match(/ensureQueuedPublicContinuation\(\{/g) ?? []).length >= 3,
  'normal terminal, active-key loser, and outer fatal paths must share continuation scheduling',
)
assert.match(
  routeSource,
  /async function handoffConcurrentPublicInput[\s\S]{0,1800}enqueueMessage\([\s\S]{0,500}idempotencyKey: `public-chat-submit:\$\{messageId\}`[\s\S]{0,120}messageId/,
  'every Run-state CAS loser must durably enqueue the exact public input with a stable message identity',
)
assert.match(
  routeSource,
  /const initialBroadcastId = internalRunnerRun[\s\S]{0,120}`submission:\$\{convId\}:\$\{randomUUID\(\)\}`/,
  'every public HTTP submission must use a private pre-reservation broadcast channel',
)
assert.match(
  routeSource,
  /const discardOwnedBroadcast = \(\) => \{[\s\S]{0,220}discardBroadcast\(ownedBroadcastId\)[\s\S]*if \(broadcastId\) \{[\s\S]{0,220}closeBroadcast\(broadcastId\)/,
  'submission completion and finally must close only the channel identity owned by that request',
)
assert.match(
  routeSource,
  /if \(!agentRun\) \{[\s\S]{0,500}handoffConcurrentPublicInput\(\{[\s\S]{0,240}holdingRunId: `resume-holding:\$\{userMessageId\}`/,
  'a waiting/recoverable resume CAS loser must use the same durable hand-off path',
)
assert.match(
  routeSource,
  /holdingRunId,[\s\S]{0,1000}releasePendingPublicUserMessageTarget\([\s\S]{0,180}holdingRunId/,
  'a loser may release only its exact holding receipt, never another active Run queue',
)
const continuationHelperSource = routeSource.slice(
  routeSource.indexOf('async function ensureQueuedPublicContinuation'),
  routeSource.indexOf('async function handoffConcurrentPublicInput'),
)
assert.ok(
  continuationHelperSource.indexOf('availableAt: new Date(Date.now() + 30_000)')
    < continuationHelperSource.indexOf('releaseTransport?.()')
    && continuationHelperSource.indexOf('releaseTransport?.()')
      < continuationHelperSource.indexOf('makeQueuedAgentRunAvailable(effectiveRunId, userId)')
    && continuationHelperSource.indexOf('makeQueuedAgentRunAvailable(effectiveRunId, userId)')
      < continuationHelperSource.lastIndexOf('wakeAgentRunner()'),
  'continuation dispatch must remain gated until the old owner channel is synchronously discarded',
)
assert.match(
  routeSource,
  /unregisterAbort\(convId, registeredAbortController \?\? undefined\)/,
  'a stale request must unregister only the AbortController it installed',
)
assert.match(
  routeSource,
  /canAcceptQueuedUserInput\(latestActiveRun\)[\s\S]{0,100}isPublicRootAgentRun\(latestActiveRun\)/,
  'active-key loser delivery must reject cancelling or non-public Runs',
)
assert.match(
  routeSource,
  /\['waiting_user', 'waiting_agents', 'recoverable'\]\.includes\(concurrentRun\.status\)[\s\S]{0,160}resumeWaitingAgentRun\(concurrentRun\.run_id, userId\)/,
  'an existing waiting public Root must be resumed so untargeted input cannot remain stranded',
)
assert.match(
  routeSource,
  /type: 'message_queued'[\s\S]{0,400}type: 'run_detached'/,
  'durable queue hand-off must emit an explicit receipt before reconnecting the browser',
)
assert.match(
  routeSource,
  /if \(runStatePersisted && \(userCancelled \|\| !processInterrupted\)\) \{[\s\S]{0,160}await releaseQueuedMessagesForRun\(agentRunId\)[\s\S]{0,500}await ensureQueuedPublicContinuation\(\{[\s\S]{0,160}sourceRun: agentRun/,
  'the outer fatal catch must schedule or reuse a continuation after releasing public queue rows',
)
assert.match(
  interruptRouteSource,
  /await retargetPendingQueuedMessage\([\s\S]{0,650}run_id: latestActiveRun\.run_id/,
  'interrupt boundary responses must always identify the latest active Run, even when retarget CAS loses',
)
assert.doesNotMatch(
  interruptRouteSource,
  /run_id:\s*retargeted\s*\?/,
  'a failed retarget CAS must never point Stop back at the stale Run',
)
assert.doesNotMatch(routeSource, /runCompletedNormally/)

assert.equal(
  canAcceptQueuedUserInput({ status: 'running', cancellation_requested: false }),
  true,
)
assert.equal(
  canAcceptQueuedUserInput({ status: 'running', cancellation_requested: true }),
  false,
  'a cancelling Run must never accept a queued user message',
)

assert.deepEqual(resolveRunIdentityEvent({
  activeRunId: 'run-b',
  expectedRunId: 'run-a',
  eventType: 'run_started',
  eventRunId: 'run-a',
  isCurrentStream: true,
}), {
  accepted: false,
  nextActiveRunId: 'run-b',
}, 'an old Run A stream must not replace a known newer Run B')

assert.deepEqual(resolveRunIdentityEvent({
  activeRunId: 'run-b',
  expectedRunId: 'run-a',
  eventType: 'run_state',
  eventRunId: 'run-a',
  eventStatus: 'completed',
  isCurrentStream: true,
}), {
  accepted: true,
  nextActiveRunId: 'run-b',
}, 'a terminal Run A state must never become active or clear Run B')

assert.deepEqual(resolveRunIdentityEvent({
  activeRunId: 'run-a',
  expectedRunId: 'run-a',
  eventType: 'run_detached',
  eventRunId: 'run-b',
  isCurrentStream: true,
}), {
  accepted: true,
  nextActiveRunId: 'run-b',
}, 'the current Run A stream may hand off identity to continuation Run B')

assert.deepEqual(resolveRunIdentityEvent({
  activeRunId: 'run-c',
  expectedRunId: 'run-a',
  eventType: 'run_detached',
  eventRunId: 'run-b',
  isCurrentStream: false,
}), {
  accepted: false,
  nextActiveRunId: 'run-c',
}, 'a stale stream generation must not replay an obsolete A to B handoff over Run C')

assert.deepEqual(resolveRunIdentityEvent({
  activeRunId: 'run-a',
  expectedRunId: 'run-b',
  eventType: 'run_detached',
  eventRunId: 'run-b',
  isCurrentStream: true,
  allowRunReplacement: true,
}), {
  accepted: true,
  nextActiveRunId: 'run-b',
}, 'an accepted normal loser stream may establish Run B with its first detached event')

async function verifyRunBoundaryRouting(): Promise<void> {
  const noWait = async () => undefined

  const normalCalls: ChatSubmissionTransport[] = []
  const normalFallback = await routeChatSubmission(
    'normal',
    async transport => {
      normalCalls.push(transport)
      return transport === 'normal'
        ? { ok: false, status: 409, code: 'already_running', value: transport }
        : { ok: true, status: 200, value: transport }
    },
    { wait: noWait },
  )
  assert.deepEqual(normalCalls, ['normal', 'interrupt'])
  assert.equal(normalFallback.transport, 'interrupt')
  assert.equal(normalFallback.ok, true)

  const interruptCalls: ChatSubmissionTransport[] = []
  const interruptFallback = await routeChatSubmission(
    'interrupt',
    async transport => {
      interruptCalls.push(transport)
      return transport === 'interrupt'
        ? { ok: false, status: 409, code: 'no_active_run', value: transport }
        : { ok: true, status: 200, value: transport }
    },
    { wait: noWait },
  )
  assert.deepEqual(interruptCalls, ['interrupt', 'normal'])
  assert.equal(interruptFallback.transport, 'normal')
  assert.equal(interruptFallback.ok, true)

  const alternatingCalls: ChatSubmissionTransport[] = []
  const waits: number[] = []
  const exhausted = await routeChatSubmission(
    'normal',
    async transport => {
      alternatingCalls.push(transport)
      return transport === 'normal'
        ? { ok: false, status: 409, code: 'already_running', value: transport }
        : { ok: false, status: 409, code: 'no_active_run', value: transport }
    },
    { wait: async ms => { waits.push(ms) } },
  )
  assert.deepEqual(alternatingCalls, ['normal', 'interrupt', 'normal', 'interrupt', 'normal'])
  assert.deepEqual(waits, [80, 160, 320, 320])
  assert.equal(exhausted.exhausted, true)
  assert.equal(exhausted.attempts, 5)

  let unexpectedSwitchCalls = 0
  const stableFailure = await routeChatSubmission(
    'normal',
    async transport => {
      unexpectedSwitchCalls += 1
      return { ok: false, status: 409, code: 'different_conflict', value: transport }
    },
    { wait: noWait },
  )
  assert.equal(unexpectedSwitchCalls, 1)
  assert.equal(stableFailure.exhausted, false)
}

void verifyRunBoundaryRouting()
  .then(() => console.log('chat-submission-contracts:verify passed'))
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
