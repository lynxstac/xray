export default function App({ Component }: { Component: () => unknown }) {
  return <>{String(Component())}</>;
}
