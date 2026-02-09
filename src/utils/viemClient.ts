import { http, type Chain as ViemChain, createPublicClient } from 'viem';
import { defineChain } from 'viem';
import {
  arbitrum,
  avalanche,
  base,
  berachain,
  bsc,
  fantom,
  fraxtal,
  gnosis,
  linea,
  lisk,
  mainnet,
  manta,
  mantle,
  megaeth,
  metis,
  mode,
  monad,
  moonbeam,
  optimism,
  plasma,
  polygon,
  rootstock,
  saga,
  scroll,
  sei,
  sonic,
  zksync,
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
  avax: avalanche,
  base: base,
  berachain: berachain,
  bsc: bsc,
  ethereum: mainnet,
  fantom: fantom,
  fraxtal: fraxtal,
  gnosis: gnosis,
  hyperevm: hyperevm,
  linea: linea,
  lisk: lisk,
  manta: manta,
  mantle: mantle,
  megaeth: megaeth,
  metis: metis,
  mode: mode,
  moonbeam: moonbeam,
  monad: monad,
  optimism: optimism,
  plasma: plasma,
  polygon: polygon,
  rootstock: rootstock,
  saga: saga,
  scroll: scroll,
  sei: sei,
  sonic: sonic,
  zksync: zksync,
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
