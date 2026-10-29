export async function loadPage(name: string) {
  return import(`../pages/${name}`);
}

export const lazy = () => import('@/pages/ListPage');
