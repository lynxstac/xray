import { Layout, ArticleCard } from '@/components';
import { useArticle } from '@/hooks/useArticle';

export default function ArticlePage({ id }: { id: string }) {
  const a = useArticle(id);
  return (
    <Layout>
      <ArticleCard title={String(a)} />
    </Layout>
  );
}
