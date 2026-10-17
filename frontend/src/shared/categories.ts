export interface Category { id: string; name: string }
export function groupConversations<T extends { categoryId?: string | null }>(conversations: T[], categories: Category[], includeEmpty = false): { id: string | null; name: string; conversations: T[] }[] {
  const known = new Set(categories.map(category => category.id));
  return [...categories.map(category => ({ ...category, conversations: conversations.filter(c => c.categoryId === category.id) })),
    { id: null, name: 'Uncategorized', conversations: conversations.filter(c => !c.categoryId || !known.has(c.categoryId)) }].filter(group => group.conversations.length > 0 || (includeEmpty && group.id !== null));
}
