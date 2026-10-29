export default function Layout({ children }: { children?: unknown }) {
  return <main>{String(children)}</main>;
}
