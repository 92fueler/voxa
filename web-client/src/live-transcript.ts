/** Ephemeral display only. Final provider text replaces drafts; nothing is persisted here. */
export interface CaptionEvent {
  speaker: 'user' | 'assistant';
  responseId?: string;
  kind: 'start' | 'delta' | 'final' | 'failed';
  itemId: string;
  index: number;
  text?: string;
  eventId?: string;
}
export interface LiveTurn { itemId: string; speaker: 'user' | 'assistant'; text: string; status: 'draft' | 'final' | 'unconfirmed' | 'interrupted' }
interface Part { text: string; final: boolean; failed: boolean }
interface Item { itemId: string; speaker: 'user' | 'assistant'; responseId?: string; parts: Map<number, Part>; ended: boolean; interrupted: boolean }

export class LiveTranscript {
  private items: Item[] = [];
  private seenItems = new Set<string>();
  private seenEvents = new Set<string>();
  private interrupted = new Set<string>();

  accept(event: CaptionEvent): boolean {
    let item = this.items.find(value => value.itemId === event.itemId);
    if (item && (item.speaker !== event.speaker || (item.responseId && event.responseId && item.responseId !== event.responseId))) return false;
    if (event.eventId && this.seenEvents.has(event.eventId)) return false;
    if (event.eventId) {
      if (this.seenEvents.size >= 4000) this.seenEvents.delete(this.seenEvents.values().next().value!);
      this.seenEvents.add(event.eventId);
    }
    if (!item) {
      if (this.seenItems.has(event.itemId) || this.seenItems.size >= 2000) return false;
      this.seenItems.add(event.itemId);
      item = { itemId: event.itemId, speaker: event.speaker, responseId: event.responseId, parts: new Map(), ended: false, interrupted: false };
      this.items.push(item);
      if (this.items.length > 6) this.items.shift();
    }
    item.responseId ??= event.responseId;
    item.interrupted ||= item.speaker === 'assistant' && (this.interrupted.has(`item:${item.itemId}`) || this.interrupted.has(`response:${item.responseId}`));
    if (event.kind === 'start') return true;
    const previous = item.parts.get(event.index);
    // A final is authoritative even when late deltas/failures arrive afterward.
    if (previous?.final) return false;
    const next: Part = event.kind === 'final'
      ? { text: event.text ?? '', final: true, failed: false }
      : event.kind === 'failed'
        ? { text: previous?.text ?? '', final: false, failed: true }
        : { text: (previous?.text ?? '') + (event.text ?? ''), final: false, failed: previous?.failed ?? false };
    const size = [...item.parts.entries()].reduce((sum, [index, part]) => sum + (index === event.index ? 0 : part.text.length), next.text.length);
    // Do not silently truncate or label oversized partial content as finalized.
    item.parts.set(event.index, size <= 32000 ? next : { text: previous?.text ?? '', final: false, failed: true });
    return true;
  }

  interrupt(target: { responseId?: string; itemId?: string }): boolean {
    for (const key of [target.responseId && `response:${target.responseId}`, target.itemId && `item:${target.itemId}`]) {
      if (key && this.interrupted.size < 4000) this.interrupted.add(key);
    }
    let changed = false;
    for (const item of this.items) {
      if (item.speaker === 'assistant' && !item.interrupted && ((target.itemId && item.itemId === target.itemId) || (target.responseId && item.responseId === target.responseId))) {
        item.interrupted = true; changed = true;
      }
    }
    return changed;
  }

  finish(): void { this.items.forEach(item => { item.ended = true; }); }

  snapshot(): LiveTurn[] {
    return this.items.map(item => {
      const parts = [...item.parts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part);
      const final = parts.length > 0 && parts.every(part => part.final);
      return { itemId: item.itemId, speaker: item.speaker, text: parts.map(part => part.text).join('\n'), status: item.interrupted ? 'interrupted' : final ? 'final' : item.ended || parts.some(part => part.failed) ? 'unconfirmed' : 'draft' };
    });
  }
}
