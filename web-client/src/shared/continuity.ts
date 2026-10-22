export interface SummaryPoint { kind: 'topic' | 'fact' | 'decision' | 'open_question'; text: string; sourceTurnIds: string[] }
export interface ContinuitySummary { title?: string; titleSourceTurnIds?: string[]; points: SummaryPoint[]; warnings: string[]; sourceRevision: number; model: string; createdAt: number }
export interface SummaryRecord { status: 'pending' | 'running' | 'ready' | 'failed'; sourceRevision: number; value: ContinuitySummary | null }
export interface ContextPreview { summariesOnly?: boolean; token: string; text: string; sessions: { id: string; revision: number; startedAt: number }[]; warnings: string[]; sections: { startedAt: number; points: SummaryPoint[]; recentTurns: { speaker: string; text: string; sourceTurnId: string }[] }[]; expiresAt: number }

/** The preview UI and early Start must accept exactly the same summary-only packet. */
export function isSummaryPreview(value: unknown, ids: string[]): value is ContextPreview {
  if (!value || typeof value !== 'object') return false;
  const packet = value as ContextPreview;
  return typeof packet.token === 'string' && /^[a-f0-9]{64}$/.test(packet.token)
    && packet.summariesOnly === true && typeof packet.text === 'string' && !!packet.text
    && new TextEncoder().encode(packet.text).length <= 6000
    && Number.isFinite(packet.expiresAt) && packet.expiresAt > Date.now()
    && Array.isArray(packet.warnings) && packet.warnings.every(warning => typeof warning === 'string')
    && Array.isArray(packet.sessions) && packet.sessions.length === ids.length
    && packet.sessions.every((source, index) => source && source.id === ids[index])
    && Array.isArray(packet.sections) && packet.sections.length === ids.length
    && packet.sections.every(section => section && Array.isArray(section.recentTurns) && !section.recentTurns.length
      && Array.isArray(section.points) && section.points.length > 0
      && section.points.every(point => point && typeof point.text === 'string' && !!point.text.trim()));
}
