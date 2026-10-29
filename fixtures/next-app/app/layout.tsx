import { Header } from '@/components/Header';

export default function RootLayout({ children }: { children: unknown }) {
  return (
    <html>
      <body>
        <Header />
        {String(children)}
      </body>
    </html>
  );
}
