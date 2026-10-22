import { expect, it } from 'vitest';
import { groupConversations, type Category } from './categories';

it('groups each conversation once and keeps removed categories in Uncategorized', () => {
  const categories: Category[] = [{ id: 'a', name: 'Learning' }, { id: 'b', name: 'Work' }];
  const conversations = [{ id: 'one', categoryId: 'a' }, { id: 'two', categoryId: null }, { id: 'three', categoryId: 'removed' }, { id: 'four', categoryId: 'a' }];
  const groups = groupConversations(conversations, categories);
  expect(groups.map(g => g.name)).toEqual(['Learning', 'Uncategorized']);
  expect(groups[0].conversations.map(c => c.id)).toEqual(['one', 'four']);
  expect(groups.flatMap(g => g.conversations)).toHaveLength(4);
});

it('omits empty categories from the conversation list', () => {
  const categories = [{ id: 'empty', name: 'Empty category' }];
  expect(groupConversations([], categories)).toEqual([]);
});
