import { type Hex, getContract } from 'viem';
import type { BeefyViemClient } from '../../../utils/viemClient';
import { BeefyVaultV7Abi } from '../../abi/BeefyVaultV7Abi';
import { GammaHypervisorAbi } from '../../abi/GammaHypervisorAbi';
import type { BeefyVault } from '../../vault/getBeefyVaultConfig';
import type { BeefyVaultBreakdown } from '../types';

export const getGammaVaultBreakdown = async (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
): Promise<BeefyVaultBreakdown> => {
  const vaultContract = getContract({
    client,
    address: vault.vault_address,
    abi: BeefyVaultV7Abi,
  });
  const hypervisorContract = getContract({
    client,
    address: vault.undelying_lp_address,
    abi: GammaHypervisorAbi,
  });

  const [balance, vaultTotalSupply, totalSupply, totalAmounts, token0, token1] = await Promise.all([
    vaultContract.read.balance({ blockNumber }),
    vaultContract.read.totalSupply({ blockNumber }),
    hypervisorContract.read.totalSupply({ blockNumber }),
    hypervisorContract.read.getTotalAmounts({ blockNumber }),
    hypervisorContract.read.token0({ blockNumber }),
    hypervisorContract.read.token1({ blockNumber }),
  ]);

  return {
    vault,
    blockNumber,
    vaultTotalSupply,
    isLiquidityEligible: true,
    balances: [
      {
        tokenAddress: token0.toLocaleLowerCase() as Hex,
        vaultBalance: (totalAmounts[0] * balance) / totalSupply,
      },
      {
        tokenAddress: token1.toLocaleLowerCase() as Hex,
        vaultBalance: (totalAmounts[1] * balance) / totalSupply,
      },
    ],
  };
};
