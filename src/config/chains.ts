import { Enum } from '@sinclair/typebox';
import { StringEnum } from '../utils/typebox';

export enum ChainId {
  arbitrum = 'arbitrum',
  base = 'base',
  bsc = 'bsc',
  ethereum = 'ethereum',
  fraxtal = 'fraxtal',
  linea = 'linea',
  mantle = 'mantle',
  mode = 'mode',
  optimism = 'optimism',
}

export const allChainIds: Array<ChainId> = Object.values(ChainId);
export const chainIdSchema = StringEnum(allChainIds);
export const chainIdAsKeySchema = Enum(ChainId);
