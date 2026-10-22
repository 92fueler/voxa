import { expect, it } from 'vitest';
import { isSummaryPreview } from './continuity';
const packet = () => ({ token: 'a'.repeat(64), text: 'Quoted summary', expiresAt: Date.now() + 60000, summariesOnly: true, warnings: [], sessions: [{ id: 'chosen' }], sections: [{ points: [{ text: 'An insight' }], recentTurns: [] }] });
it('accepts only an unexpired summary-only preview bound to the exact selection', () => {
  expect(isSummaryPreview(packet(), ['chosen'])).toBe(true);
  for (const value of [null, {}, { ...packet(), token: 'bad' }, { ...packet(), expiresAt: Date.now() - 1 }, { ...packet(), expiresAt: NaN }, { ...packet(), summariesOnly: false }, { ...packet(), text: '中'.repeat(2001) }, { ...packet(), sessions: [{ id: 'unselected' }] }, { ...packet(), sections: [null] }, { ...packet(), sections: [{ points: [{ text: 'insight' }], recentTurns: [{ text: 'raw transcript' }] }] }, { ...packet(), sections: [{ points: [{ text: 42 }], recentTurns: [] }] }]) expect(isSummaryPreview(value, ['chosen'])).toBe(false);
});
