export interface SavedTurn {
  itemId: string;
  previousItemId: string | null;
  orderKnown: boolean;
  speaker: 'user' | 'assistant';
  text: string;
  status: 'incomplete' | 'completed' | 'interrupted';
  revision: number;
  createdAt: number;
}
