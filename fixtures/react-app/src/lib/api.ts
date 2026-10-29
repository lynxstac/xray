export const BASE = '/api/v1';

export async function fetchArticles(): Promise<string[]> {
  return request(`${BASE}/articles`);
}

export async function fetchArticle(id: string) {
  return request(`${BASE}/articles/${id}`);
}

function request(url: string) {
  return fetch(url).then((r) => r.json());
}
