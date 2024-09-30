import { type Hex, getContract } from 'viem';
import type { BeefyViemClient } from '../../../utils/viemClient';
import { BalancerPoolAbi } from '../../abi/BalancerPool';
import { BalancerVaultAbi } from '../../abi/BalancerVault';
import { BeefyVaultV7Abi } from '../../abi/BeefyVaultV7Abi';
import type { BeefyVault } from '../../vault/getBeefyVaultConfig';
import type { BeefyVaultBreakdown } from '../types';

/**
 * 
export function getVaultTokenBreakdownBalancer(vault: BeefyVault): Array<TokenBalance> {
  let balances = new Array<TokenBalance>()

  const vaultContract = BeefyVaultV7Contract.bind(Address.fromBytes(vault.sharesToken))
  const wantTotalBalance = vaultContract.balance()

  // fetch on chain data
  const balancerPoolContract = BalancerPoolContract.bind(Address.fromBytes(vault.underlyingToken))
  const balancerVaultAddress = balancerPoolContract.getVault()
  const balancerPoolId = balancerPoolContract.getPoolId()
  const balancerTotalSupply = balancerPoolContract.getActualSupply()
  const balancerVaultContract = BalancerVaultContract.bind(balancerVaultAddress)
  const poolTokensRes = balancerVaultContract.getPoolTokens(balancerPoolId)
  const poolTokens = poolTokensRes.getTokens()
  const poolBalances = poolTokensRes.getBalances()

  // compute breakdown
  for (let i = 0; i < poolTokens.length; i++) {
    const poolToken = poolTokens[i]
    const poolBalance = poolBalances[i]
    balances.push(new TokenBalance(poolToken, poolBalance.times(wantTotalBalance).div(balancerTotalSupply)))
  }

  return balances
}

 */
export const getBalancerAuraVaultBreakdown = async (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
): Promise<BeefyVaultBreakdown> => {
  const vaultContract = getContract({
    client,
    address: vault.vault_address,
    abi: BeefyVaultV7Abi,
  });

  const balancerPoolContract = getContract({
    client,
    address: vault.undelying_lp_address,
    abi: BalancerPoolAbi,
  });

  const [
    vaultWantBalance,
    vaultTotalSupply,
    balancerVaultAddress,
    balancerPoolId,
    balancerTotalSupply,
  ] = await Promise.all([
    vaultContract.read.balance({ blockNumber }),
    vaultContract.read.totalSupply({ blockNumber }),
    balancerPoolContract.read.getVault({ blockNumber }),
    balancerPoolContract.read.getPoolId({ blockNumber }),
    balancerPoolContract.read.getActualSupply({ blockNumber }),
  ]);

  const balancerVaultContract = getContract({
    client,
    address: balancerVaultAddress,
    abi: BalancerVaultAbi,
  });
  const poolTokenRes = await balancerVaultContract.read.getPoolTokens([balancerPoolId], {
    blockNumber,
  });
  const poolTokens = poolTokenRes[0];
  const poolBalances = poolTokenRes[1];

  return {
    vault,
    blockNumber,
    vaultTotalSupply,
    isLiquidityEligible: true,
    balances: poolTokens.map((poolToken, i) => ({
      tokenAddress: poolToken.toLocaleLowerCase() as Hex,
      vaultBalance: (poolBalances[i] * vaultWantBalance) / balancerTotalSupply,
    })),
  };
};
