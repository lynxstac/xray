export function add(a: number, b: number): number {
  return a + b;
}
export const mul = (a: number, b: number) => a * b;
export default function sub(a: number, b: number) {
  return a - b;
}
export class Calc {
  run() {
    return add(1, 2);
  }
}
const hidden = () => 0;
export { hidden as zero };
