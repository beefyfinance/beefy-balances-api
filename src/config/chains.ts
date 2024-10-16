import { Enum } from '@sinclair/typebox';
import { StringEnum } from '../utils/typebox';

export enum ChainId {
  arbitrum = 'arbitrum',
  avax = 'avax',
  base = 'base',
  bsc = 'bsc',
  ethereum = 'ethereum',
  fantom = 'fantom',
  fraxtal = 'fraxtal',
  gnosis = 'gnosis',
  linea = 'linea',
  manta = 'manta',
  mantle = 'mantle',
  metis = 'metis',
  mode = 'mode',
  moonbeam = 'moonbeam',
  optimism = 'optimism',
  polygon = 'polygon',
  rootstock = 'rootstock',
  sei = 'sei',
  scroll = 'scroll',
  zksync = 'zksync',
}

export const allChainIds: Array<ChainId> = Object.values(ChainId);
export const chainIdSchema = StringEnum(allChainIds);
export const chainIdAsKeySchema = Enum(ChainId);
