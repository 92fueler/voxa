export interface SummaryPoint { kind: 'topic' | 'fact' | 'decision' | 'open_question'; text: string; sourceTurnIds: string[] }
export interface ContinuitySummary { title?: string; titleSourceTurnIds?: string[]; points: SummaryPoint[]; warnings: string[]; sourceRevision: number; model: string; createdAt: number }
export interface SummaryRecord { status: 'pending' | 'running' | 'ready' | 'failed'; sourceRevision: number; value: ContinuitySummary | null }
export interface ContextPreview { token: string; text: string; sessions: { id: string; revision: number; startedAt: number }[]; warnings: string[]; sections: { startedAt: number; points: SummaryPoint[]; recentTurns: { speaker: string; text: string; sourceTurnId: string }[] }[]; expiresAt: number }
