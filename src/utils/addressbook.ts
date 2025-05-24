import { type Token, addressBook } from 'blockchain-addressbook';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';

export const getTokenAddressBySymbol = (chainId: ChainId, symbol: string): Hex | null => {
  return (addressBook[chainId]?.tokens[symbol]?.address as Hex) || null;
};

export const getTokenConfigBySymbol = (chainId: ChainId, symbol: string): Token | null => {
  return addressBook[chainId]?.tokens[symbol] ?? null;
};

export const getWNativeToken = (chainId: ChainId): Token => {
  const token = addressBook[chainId]?.tokens.WNATIVE;
  if (!token) {
    throw new Error(`WNATIVE token is not available on chain ${chainId}`);
  }
  return token;
};

export const getNativeTokenSymbol = (chainId: ChainId): string => {
  return addressBook[chainId]?.native.symbol;
};

export const isNativeToken = (chainId: ChainId, symbol: string) => {
  if (symbol === getNativeTokenSymbol(chainId)) {
    return true;
  }

  const wnative = getWNativeToken(chainId);
  return `W${symbol}` === wnative.symbol || symbol === 'ETH';
};
