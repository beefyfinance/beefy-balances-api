import { getContract } from 'viem';
import type { BeefyViemClient } from '../../../utils/viemClient';
import { BeefyVaultV7Abi } from '../../abi/BeefyVaultV7Abi';
import type { BeefyVault } from '../../vault/getBeefyVaultConfig';
import type { BeefyVaultBreakdown } from '../types';

export const getEulerVaultBreakdown = async (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
): Promise<BeefyVaultBreakdown> => {
  // euler vaults are single tokens, a simple balance() call is enough
  // https://plasmascan.to/address/0x5aF45b3A8cB44B444dDf9cCEB90F5998EAc0FC97/contract/9745/readProxyContract
  // https://app.beefy.finance/vault/euler-plasma-k3capital-usdt0

  const vaultContract = getContract({
    client,
    address: vault.vault_address,
    abi: BeefyVaultV7Abi,
  });

  const [vaultWantBalance, vaultTotalSupply] = await Promise.all([
    vaultContract.read.balance({ blockNumber }),
    vaultContract.read.totalSupply({ blockNumber }),
  ]);

  return {
    vault,
    blockNumber,
    vaultTotalSupply: vaultTotalSupply,
    isLiquidityEligible: true,
    balances: [
      {
        tokenAddress: vault.undelying_lp_address,
        vaultBalance: vaultWantBalance,
      },
    ],
  };
};
