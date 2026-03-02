import Decimal from 'decimal.js';

export const interpretAsDecimal = (rawValue: string, decimals: string | number): Decimal => {
  return new Decimal(rawValue).dividedBy(new Decimal(10).pow(decimals));
};

export const decimalToBigInt = (value: Decimal, decimals: number): bigint => {
  return BigInt(value.times(new Decimal(10).pow(decimals)).toFixed(0));
};
