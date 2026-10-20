// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LiveTranscriptView } from './LiveTranscriptView';

afterEach(cleanup);
it('labels uncertain text and replaces it with exact final text without claiming it is saved', () => {
  const { rerender } = render(<LiveTranscriptView turns={[{ itemId: 'u', text: 'cash', status: 'draft' }]} />);
  expect(screen.getByText('Draft · may change')).toBeTruthy();
  rerender(<LiveTranscriptView turns={[{ itemId: 'u', text: '缓存 cache', status: 'final' }]} />);
  expect(screen.queryByText('cash')).toBeNull();
  expect(screen.getByText('缓存 cache')).toBeTruthy();
  expect(screen.getByText('Finalized')).toBeTruthy();
  expect(screen.getByText(/not a save confirmation/)).toBeTruthy();
  rerender(<LiveTranscriptView turns={[{ itemId: 'u', text: '<script>text</script>', status: 'unconfirmed' }]} />);
  expect(screen.getByText(/Unconfirmed/)).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
});
it('does not reserve live transcript space before any speech', () => {
  const { container } = render(<LiveTranscriptView turns={[]} />);
  expect(container.innerHTML).toBe('');
});
