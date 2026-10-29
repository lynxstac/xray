import * as comps from '@/components';
import { useArticles } from '../hooks/useArticles';

export function ListPage() {
  const items = useArticles();
  return <comps.Layout>{String(items)}</comps.Layout>;
}
