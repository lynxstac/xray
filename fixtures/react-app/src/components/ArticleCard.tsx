import { formatDate } from '@/lib';

export function ArticleCard({ title }: { title: string }) {
  return (
    <div>
      {title} {formatDate(new Date())}
    </div>
  );
}
