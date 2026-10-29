import { it } from '../testkit';
import { useArticle } from './useArticle';

it('loads an article', () => {
  useArticle('1');
});
