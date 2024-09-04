import { Enum } from '@sinclair/typebox';
import { StringEnum } from '../utils/typebox';

export enum ChainId {
  arbitrum = 'arbitrum',
  avalanche = 'avalanche',
  base = 'base',
  bsc = 'bsc',
  ethereum = 'ethereum',
  fantom = 'fantom',
  fraxtal = 'fraxtal',
  linea = 'linea',
  manta = 'manta',
  mantle = 'mantle',
  mode = 'mode',
  moonbeam = 'moonbeam',
  optimism = 'optimism',
  polygon = 'polygon',
  sei = 'sei',
  zksync = 'zksync',
}

export const allChainIds: Array<ChainId> = Object.values(ChainId);
export const chainIdSchema = StringEnum(allChainIds);
export const chainIdAsKeySchema = Enum(ChainId);
