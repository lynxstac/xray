import { useState } from 'react';
import { fetchArticle } from '@/lib';

export function useArticle(id: string) {
  const [a] = useState<unknown>(null);
  fetchArticle(id);
  return a;
}
