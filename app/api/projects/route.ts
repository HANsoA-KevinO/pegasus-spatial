import { NextRequest, NextResponse } from 'next/server'
import { listProjects } from '@/lib/db/repository'
import { resolveLocalOwner } from '@/lib/local-owner'
import { selectProjectCoverAssets } from '@/lib/projects/project-cover'
import { listPublishedSpatialCoverJobs } from '@/lib/spatial/repository'
import { AgentTeamNotFoundError, agentTeamService } from '@/lib/agent-team'
import {
  MultiAgentWorkspaceRepository,
  workspaceFileSnapshotToFileEntry,
} from '@/lib/workspace/multi-agent'
import { hideInternalWorkspaceState } from '@/lib/workspace/public-view'
import type { FileEntry } from '@/lib/workspace/types'

async function projectFiles(
  project: Record<string, unknown>,
  userId: string,
  workspaceRepository: MultiAgentWorkspaceRepository,
): Promise<Record<string, FileEntry>> {
  const conversationId = typeof project.conversation_id === 'string'
    ? project.conversation_id
    : ''
  const existingOutput = project.output
  const output = existingOutput && typeof existingOutput === 'object' && !Array.isArray(existingOutput)
    ? existingOutput as Record<string, unknown>
    : {}
  project.output = output
  const existingFiles = output.files
  const files = {
    ...(existingFiles && typeof existingFiles === 'object' && !Array.isArray(existingFiles)
      ? existingFiles as Record<string, FileEntry>
      : {}),
  }

  let authoritativeFiles: Awaited<ReturnType<MultiAgentWorkspaceRepository['listFiles']>> = []
  try {
    // The multi-agent workspace is authoritative for current projects. Reading
    // the team instead of ensuring it keeps the project-library endpoint free
    // of bootstrap side effects for older conversations.
    const team = await agentTeamService.getTeam({ conversationId, userId })
    authoritativeFiles = await workspaceRepository.listFiles(team.workspace_id, {
      teamId: team.team_id,
      agentId: team.root_agent_id,
      rootAgentId: team.root_agent_id,
      role: 'root',
    })
  } catch (error) {
    if (!(error instanceof AgentTeamNotFoundError)) {
      console.warn('Project workspace enrichment skipped', {
        conversationId,
        error: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  }

  let skippedFiles = 0
  for (const file of authoritativeFiles) {
    if (file.visibility === 'agent_private') continue
    try {
      files[file.path] = workspaceFileSnapshotToFileEntry(file, files[file.path])
    } catch {
      skippedFiles += 1
    }
  }
  if (skippedFiles > 0) {
    console.warn('Project workspace files skipped during enrichment', {
      conversationId,
      skippedFiles,
    })
  }

  output.files = files
  hideInternalWorkspaceState(project)
  return ((project.output as { files?: Record<string, FileEntry> } | undefined)?.files) ?? {}
}

export async function GET(req: NextRequest) {
  const userId = await resolveLocalOwner()
  if (userId instanceof Response) return userId

  try {
    const { searchParams } = req.nextUrl
    const page = Math.max(1, Number(searchParams.get('page') ?? 1))
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? 20)))
    const search = searchParams.get('search') ?? undefined

    const { data, total } = await listProjects(userId, page, limit, search)

    const workspaceRepository = new MultiAgentWorkspaceRepository()
    const conversationIds = data
      .map(document => document.conversation_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const [projectedProjects, coverJobs] = await Promise.all([
      Promise.all(data.map(async document => {
        const project = document.toObject() as Record<string, unknown>
        const files = await projectFiles(project, userId, workspaceRepository)
        return { project, files }
      })),
      listPublishedSpatialCoverJobs(userId, conversationIds).catch(error => {
        console.warn('Project cover job enrichment skipped', {
          error: error instanceof Error ? error.name : 'UnknownError',
        })
        return []
      }),
    ])
    const jobsByConversation = new Map<string, typeof coverJobs>()
    for (const job of coverJobs) {
      const existing = jobsByConversation.get(job.conversation_id) ?? []
      existing.push(job)
      jobsByConversation.set(job.conversation_id, existing)
    }

    const projects = projectedProjects.map(({ project, files }) => {
      const cover = selectProjectCoverAssets(
        files,
        jobsByConversation.get(String(project.conversation_id)) ?? [],
      )
      delete project.output
      return {
        ...project,
        file_count: Object.keys(files).length,
        cover_kind: cover.kind,
        cover_images: cover.images,
      }
    })

    return NextResponse.json({
      projects,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}
