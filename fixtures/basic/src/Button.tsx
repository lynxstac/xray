import React from 'react';
import * as math from './math';
import './styles.css';
import { helper as h, type Foo } from './utils';

export default function Button() {
  const n = useCounter();
  return <button onClick={() => math.add(n, 1)}>{String(h({ n } as Foo))}</button>;
}

export function useCounter() {
  return React.useState(0)[0];
}

export const Memo = React.memo(function Memo() {
  return <i />;
});
