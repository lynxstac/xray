import { Sidebar } from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: unknown }) {
  return (
    <div>
      <Sidebar />
      {String(children)}
    </div>
  );
}
