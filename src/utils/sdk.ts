import { GraphQLClient } from 'graphql-request';
import { SUBGRAPH_URL } from '../config/env';
import { getSdk } from '../queries/codegen/sdk';

let globalSdk: ReturnType<typeof getSdk> | null = null;

export function getGlobalSdk(): ReturnType<typeof getSdk> {
  if (!globalSdk) {
    const graphqlClient = new GraphQLClient(SUBGRAPH_URL);
    globalSdk = getSdk(graphqlClient);
  }
  return globalSdk;
}
export async function paginate<R>({
  fetchPage,
  count,
  merge,
  pageSize = 10_000,
  fetchAtMost = 1_000_000_000,
  delay = 0,
}: {
  fetchPage: (params: { offset: number; limit: number }) => Promise<R>;
  count: (res: NoInfer<R>) => number | number[];
  merge: (a: NoInfer<R>, b: NoInfer<R>) => NoInfer<R>;
  pageSize?: number;
  fetchAtMost?: number;
  delay?: number;
}): Promise<NoInfer<R>> {
  const results: R[] = [];
  let offset = 0;
  let fetched = 0;

  while (fetched < fetchAtMost) {
    const res = await fetchPage({ offset, limit: pageSize });
    results.push(res);
    const resCountOrCounts = count(res);
    const resCount = Array.isArray(resCountOrCounts)
      ? Math.max(...resCountOrCounts) || 0
      : resCountOrCounts;

    if (resCount < pageSize) {
      break;
    }
    fetched += resCount;
    offset += pageSize;

    // Add delay between fetches if specified
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (results.length === 0) {
    throw new Error('No results found');
  }
  const first = results[0];
  let res = first;
  for (let i = 1; i < results.length; i++) {
    res = merge(res, results[i]);
  }

  return res;
}
