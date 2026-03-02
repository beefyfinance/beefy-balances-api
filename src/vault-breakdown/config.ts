import { SUBGRAPH_URL } from '../config/env';

export const BEEFY_MOO_VAULT_API = 'https://api.beefy.finance/vaults';
export const BEEFY_COW_VAULT_API = 'https://api.beefy.finance/cow-vaults';
export const BEEFY_GOV_API = 'https://api.beefy.finance/gov-vaults';
export const BEEFY_BOOST_API = 'https://api.beefy.finance/boosts';

// subgraph source: https://github.com/beefyfinance/l2-lxp-liquidity-subgraph
// Single GQL endpoint for all chains
export const getBalanceSubgraphUrl = (): string => SUBGRAPH_URL;

export const SUBGRAPH_PAGE_SIZE = 1000;
