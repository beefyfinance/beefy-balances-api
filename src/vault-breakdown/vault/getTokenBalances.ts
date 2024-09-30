import type { Hex } from 'viem';
import type { ChainId } from '../../config/chains';
import { FriendlyError } from '../../utils/error';
import { getLoggerFor } from '../../utils/log';
import { SUBGRAPH_PAGE_SIZE, getBalanceSubgraphUrl } from '../config';

type TokenBalance = {
  user_address: Hex;
  token_address: Hex;
  balance: bigint;
};

type QueryResult = {
  [key in `tokenBalances${number}`]: {
    account: {
      id: Hex;
    };
    token: {
      id: Hex;
    };
    amount: string;
  }[];
};

const logger = getLoggerFor('vault-breakdown/vault/getTokenBalances');

const PARRALEL_REQUESTS = 10;
const PARRALEL_REQUESTS_ARRAY = Array.from({ length: PARRALEL_REQUESTS }, (_, i) => i);

export const getTokenBalances = async (
  chainId: ChainId,
  filters: {
    blockNumber?: bigint;
    tokenAddresses?: Hex[];
    minBalance?: bigint;
  }
): Promise<TokenBalance[]> => {
  let allPositions: TokenBalance[] = [];
  let skip = 0;
  const startAt = Date.now();
  logger.debug({
    msg: 'Fetching user balances',
    chainId,
    filters,
  });
  while (true) {
    logger.trace({
      msg: 'Fetching user balances',
      chainId,
      filters,
      skip,
    });

    const USER_BALANCES_QUERY = `
      fragment Balance on TokenBalance {
        account {
          id
        }
        token {
          id
        }
        amount
      }

      query UserBalances(
        $first: Int!, 
        ${PARRALEL_REQUESTS_ARRAY.map(i => `$skip${i}: Int!`).join(', ')}
      ) {
        ${PARRALEL_REQUESTS_ARRAY.map(
          i => `
          tokenBalances${i}: tokenBalances(
            ${filters.blockNumber ? `block: { number: ${filters.blockNumber} }` : ''}
            first: $first
            ${
              filters.minBalance || filters.tokenAddresses?.length
                ? `where: { 
              ${filters.minBalance ? `amount_gt: "${filters.minBalance}"` : ''}
              ${
                filters.tokenAddresses?.length
                  ? `token_in: [${filters.tokenAddresses.map(a => `"${a}"`).join(', ')}]`
                  : ''
              }
            }`
                : ''
            }
            skip: $skip${i}
            orderBy: id
            orderDirection: asc
          ) {
            ...Balance
          }
        `
        )}
      }
    `;

    const variables = {
      first: SUBGRAPH_PAGE_SIZE,
      ...PARRALEL_REQUESTS_ARRAY.reduce(
        (acc, i) => {
          acc[`skip${i}`] = skip + i * SUBGRAPH_PAGE_SIZE;
          return acc;
        },
        {} as { [key: string]: number }
      ),
    };

    logger.trace({
      msg: 'Querying subgraph',
      query: USER_BALANCES_QUERY,
      chainId,
      filters,
      skip,
      variables,
    });

    const response = await fetch(getBalanceSubgraphUrl(chainId), {
      method: 'POST',
      body: JSON.stringify({
        query: USER_BALANCES_QUERY,
        variables,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(text);
      throw new FriendlyError(`Subgraph query failed with status ${response.status}: ${text}`);
    }

    const res = (await response.json()) as
      | { data: QueryResult }
      | { errors: { message: string }[] };
    if ('errors' in res) {
      const errors = res.errors.map(e => e.message).join(', ');
      throw new FriendlyError(`Subgraph query failed: ${errors}`);
    }

    const foundPositions = PARRALEL_REQUESTS_ARRAY.flatMap(
      i => res.data[`tokenBalances${i}`] || []
    ).map(
      (position): TokenBalance => ({
        balance: BigInt(position.amount),
        user_address: position.account.id.toLocaleLowerCase() as Hex,
        token_address: position.token.id.toLocaleLowerCase() as Hex,
      })
    );

    allPositions = allPositions.concat(foundPositions);

    logger.debug({ msg: 'Found user balances', chainId, positions: foundPositions.length });

    if (res.data.tokenBalances9.length < SUBGRAPH_PAGE_SIZE) {
      break;
    }

    skip += SUBGRAPH_PAGE_SIZE * PARRALEL_REQUESTS;
  }

  logger.debug({
    msg: 'Fetched user balances',
    positions: allPositions.length,
    chainId,
    filters,
    duration: Date.now() - startAt,
  });

  return allPositions;
};
