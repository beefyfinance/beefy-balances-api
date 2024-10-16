import { http, type Chain as ViemChain, createPublicClient } from 'viem';
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  fantom,
  fraxtal,
  gnosis,
  //kava,
  linea,
  mainnet,
  manta,
  mantle,
  metis,
  mode,
  moonbeam,
  optimism,
  polygon,
  rootstock,
  scroll,
  sei,
  zksync,
} from 'viem/chains';
import type { ChainId } from '../config/chains';
import { createCachedFactoryByChainId } from './factory';

const mapping: Record<ChainId, ViemChain> = {
  arbitrum: arbitrum,
  avax: avalanche,
  base: base,
  bsc: bsc,
  ethereum: mainnet,
  fantom: fantom,
  fraxtal: fraxtal,
  gnosis: gnosis,
  linea: linea,
  manta: manta,
  mantle: mantle,
  metis: metis,
  mode: mode,
  moonbeam: moonbeam,
  optimism: optimism,
  polygon: polygon,
  rootstock: rootstock,
  scroll: scroll,
  sei: sei,
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
