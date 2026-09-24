import { http, type Chain as ViemChain, createPublicClient } from 'viem';
import { defineChain } from 'viem';
import {
  arbitrum,
  arc,
  avalanche,
  base,
  bsc,
  fraxtal,
  mainnet,
  megaeth,
  monad,
  optimism,
  plasma,
  polygon,
  robinhood,
  sonic,
} from 'viem/chains';
import type { ChainId } from '../config/chains';
import { createCachedFactoryByChainId } from './factory';

const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: {
    decimals: 18,
    name: 'Hyperliquid',
    symbol: 'HYPE',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
      webSocket: ['wss://rpc.hyperliquid.xyz/evm'],
    },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: '"https://www.hyperscan.com' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 13051,
    },
  },
});

const mapping: Record<ChainId, ViemChain> = {
  arbitrum: arbitrum,
  arc: arc,
  avax: avalanche,
  base: base,
  bsc: bsc,
  ethereum: mainnet,
  fraxtal: fraxtal,
  hyperevm: hyperevm,
  megaeth: megaeth,
  monad: monad,
  optimism: optimism,
  plasma: plasma,
  polygon: polygon,
  robinhood: robinhood,
  sonic: sonic,
};

export const getViemClient = createCachedFactoryByChainId(chainId => {
  return createPublicClient({
    chain: mapping[chainId],
    transport: http(),
    batch: {
      multicall: true,
    },
  });
});
export type BeefyViemClient = ReturnType<typeof getViemClient>;
