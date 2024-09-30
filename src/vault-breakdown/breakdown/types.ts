import type { Hex } from 'viem';
import type { BeefyVault } from '../vault/getBeefyVaultConfig';

export type BeefyVaultBreakdown = {
  vault: BeefyVault;
  blockNumber: bigint;
  vaultTotalSupply: bigint;
  isLiquidityEligible: boolean;
  balances: {
    tokenAddress: Hex;
    vaultBalance: bigint;
  }[];
};
