import { add } from './math';
import type { Foo } from './types';

export const helper = (f: Foo) => add(f.n, 2);
const internal = function () {
  return 1;
};
export default internal;
