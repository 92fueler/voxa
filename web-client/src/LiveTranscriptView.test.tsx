// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LiveTranscriptView } from './LiveTranscriptView';

afterEach(cleanup);
it('labels uncertain text and replaces it with exact final text without claiming it is saved', () => {
  const { rerender } = render(<LiveTranscriptView turns={[{ itemId: 'u', speaker: 'user', text: 'cash', status: 'draft' }]} />);
  expect(screen.getByText('Draft · may change')).toBeTruthy();
  rerender(<LiveTranscriptView turns={[{ itemId: 'u', speaker: 'user', text: '缓存 cache', status: 'final' }]} />);
  expect(screen.queryByText('cash')).toBeNull();
  expect(screen.getByText('缓存 cache')).toBeTruthy();
  expect(screen.getByText('Finalized')).toBeTruthy();
  expect(screen.getByText(/not a save confirmation/)).toBeTruthy();
  rerender(<LiveTranscriptView turns={[{ itemId: 'u', speaker: 'user', text: '<script>text</script>', status: 'unconfirmed' }]} />);
  expect(screen.getByText(/Unconfirmed/)).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
});
it('does not reserve live transcript space before any speech', () => {
  const { container } = render(<LiveTranscriptView turns={[]} />);
  expect(container.innerHTML).toBe('');
});

it('labels both speakers and distinguishes generated drafts from interrupted replies', () => {
  const { rerender } = render(<LiveTranscriptView turns={[
    { itemId: 'u', speaker: 'user', text: 'Explain a cache.', status: 'final' },
    { itemId: 'a', speaker: 'assistant', text: 'A cache stores', status: 'draft' },
  ]} />);
  expect(screen.getByText('You')).toBeTruthy(); expect(screen.getByText('Voxa')).toBeTruthy();
  expect(screen.getByText('Responding…')).toBeTruthy();
  expect(screen.getByText('Live transcript')).toBeTruthy();
  rerender(<LiveTranscriptView turns={[{ itemId: 'a', speaker: 'assistant', text: 'Generated text.', status: 'interrupted' }]} />);
  expect(screen.getByText(/Interrupted · some text may not have played/)).toBeTruthy();
  expect(screen.queryByText('Finalized')).toBeNull();
});
