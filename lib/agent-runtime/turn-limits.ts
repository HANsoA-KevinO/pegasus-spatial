/** One turn is a main model response, which may dispatch several tools. */
export const DEFAULT_AGENT_MAX_TURNS = 200

export function parseAgentTurnLimit(value: string | undefined, name = 'AGENT_MAX_TURNS'): number | undefined {
  if (value === undefined || value.trim() === '') return DEFAULT_AGENT_MAX_TURNS
  const turns = Number(value)
  if (!Number.isSafeInteger(turns) || turns < 0) throw new Error(`${name} must be a nonnegative safe integer (0 disables the turn cap)`)
  return turns === 0 ? undefined : turns
}

export function resolveAgentTurnLimit(role: 'root' | 'member', env: Readonly<Record<string, string | undefined>> = process.env): number | undefined {
  const name = role === 'root' ? 'AGENT_ROOT_MAX_TURNS' : 'AGENT_MEMBER_MAX_TURNS'
  return parseAgentTurnLimit(env[name]?.trim() || env.AGENT_MAX_TURNS, name)
}
