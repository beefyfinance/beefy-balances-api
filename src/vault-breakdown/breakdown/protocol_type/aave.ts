import { type Hex, getContract } from 'viem';
import type { BeefyViemClient } from '../../../utils/viemClient';
import { BeefyVaultV7Abi } from '../../abi/BeefyVaultV7Abi';
import type { BeefyVault } from '../../vault/getBeefyVaultConfig';
import type { BeefyVaultBreakdown } from '../types';

/**
 * @dev assumes no lend/borrow looping
 */
export const getAaveVaultBreakdown = async (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
): Promise<BeefyVaultBreakdown> => {
  const vaultContract = getContract({
    client,
    address: vault.vault_address,
    abi: BeefyVaultV7Abi,
  });

  const [balance, vaultTotalSupply] = await Promise.all([
    vaultContract.read.balance({ blockNumber }),
    vaultContract.read.totalSupply({ blockNumber }),
  ]);

  return {
    vault,
    blockNumber,
    vaultTotalSupply,
    isLiquidityEligible: true,
    balances: [
      {
        tokenAddress: vault.undelying_lp_address.toLocaleLowerCase() as Hex,
        vaultBalance: balance,
      },
    ],
  };
};
