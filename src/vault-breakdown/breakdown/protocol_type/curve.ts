import { type Hex, getContract } from 'viem';
import type { BeefyViemClient } from '../../../utils/viemClient';
import { BeefyVaultV7Abi } from '../../abi/BeefyVaultV7Abi';
import { CurvePoolAbi } from '../../abi/CurvePool';
import { CurveTokenAbi } from '../../abi/CurveToken';
import type { BeefyVault } from '../../vault/getBeefyVaultConfig';
import type { BeefyVaultBreakdown } from '../types';

/**
 * @dev This breaks when the lp token and lp pool are different
 * @dev Does not break down meta pools
 * TODO try to find an on-chain way to get the lp pool (as vault only provides the lp token)
 * TODO try to break down meta pools (where one token of the pool is another pool)
 */
export const getCurveVaultBreakdown = async (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
): Promise<BeefyVaultBreakdown> => {
  const vaultContract = getContract({
    client,
    address: vault.vault_address,
    abi: BeefyVaultV7Abi,
  });
  const curveTokenContract = getContract({
    client,
    address: vault.undelying_lp_address,
    abi: CurveTokenAbi,
  });
  const curvePoolContract = getContract({
    client,
    address: vault.undelying_lp_address,
    abi: CurvePoolAbi,
  });

  const [
    vaultWantBalance,
    vaultTotalSupply,
    curveTotalSupply,
    coin0,
    coin1,
    coin2,
    coin3,
    coin4,
    coin5,
    balance0,
    balance1,
    balance2,
    balance3,
    balance4,
    balance5,
  ] = await Promise.all([
    vaultContract.read.balance({ blockNumber }),
    vaultContract.read.totalSupply({ blockNumber }),
    curveTokenContract.read.totalSupply({ blockNumber }),
    curvePoolContract.read.coins([0n], { blockNumber }),
    curvePoolContract.read.coins([1n], { blockNumber }),
    curvePoolContract.read.coins([2n], { blockNumber }).catch(() => null),
    curvePoolContract.read.coins([3n], { blockNumber }).catch(() => null),
    curvePoolContract.read.coins([4n], { blockNumber }).catch(() => null),
    curvePoolContract.read.coins([5n], { blockNumber }).catch(() => null),
    curvePoolContract.read.balances([0n], { blockNumber }),
    curvePoolContract.read.balances([1n], { blockNumber }),
    curvePoolContract.read.balances([2n], { blockNumber }).catch(() => null),
    curvePoolContract.read.balances([3n], { blockNumber }).catch(() => null),
    curvePoolContract.read.balances([4n], { blockNumber }).catch(() => null),
    curvePoolContract.read.balances([5n], { blockNumber }).catch(() => null),
  ]);

  const coins = [coin0, coin1, coin2, coin3, coin4, coin5].filter(coin => coin !== null) as Hex[];
  const balances = [balance0, balance1, balance2, balance3, balance4, balance5].filter(
    balance => balance !== null
  ) as bigint[];

  return {
    vault,
    blockNumber,
    vaultTotalSupply,
    isLiquidityEligible: true,
    balances: coins.map((coin, i) => ({
      tokenAddress: coin,
      vaultBalance: (vaultWantBalance * balances[i]) / curveTotalSupply,
    })),
  };
};
