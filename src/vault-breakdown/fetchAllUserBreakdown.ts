import { uniq } from 'lodash';
import type { Hex } from 'viem';
import type { ChainId } from '../config/chains';
import { getLoggerFor } from '../utils/log';
import { getVaultBreakdowns } from './breakdown/getVaultBreakdown';
import type { BeefyVaultBreakdown } from './breakdown/types';
import { type BeefyVault, getBeefyVaultConfig } from './vault/getBeefyVaultConfig';
import { getTokenBalances } from './vault/getTokenBalances';

const logger = getLoggerFor('vault-breakdown/fetchAllUserBreakdown');

export const getUserTVLAtBlock = async (
  chainId: ChainId,
  blockNumber: bigint,
  vaultFilter: (vault: BeefyVault) => boolean
) => {
  logger.debug({ msg: 'Fetching user TVL', blockNumber, chainId });

  const [allVaultConfigs, investorPositions] = await Promise.all([
    getBeefyVaultConfig(chainId, vaultFilter),
    getTokenBalances(chainId, {
      blockNumber: BigInt(blockNumber),
      minBalance: BigInt(1),
    }),
  ]);
  logger.debug({
    msg: 'Fetched vaults and positions',
    vaultConfigs: allVaultConfigs.length,
    positions: investorPositions.length,
  });

  const vaultConfigs = allVaultConfigs.filter(vaultFilter);

  // merge investor positions for clm and reward pools
  const vaultRewardPoolMap: Record<string, string> = {};
  for (const vault of vaultConfigs) {
    vaultRewardPoolMap[vault.vault_address] = vault.vault_address;
    for (const pool of vault.reward_pools) {
      vaultRewardPoolMap[pool.reward_pool_address] = vault.vault_address;
    }
  }

  const mergedInvestorPositionsByInvestorAndClmAddress: Record<
    string,
    (typeof investorPositions)[0]
  > = {};
  for (const position of investorPositions) {
    const vaultAddress = vaultRewardPoolMap[position.token_address];
    const key = `${position.user_address}_${vaultAddress}`;
    if (!mergedInvestorPositionsByInvestorAndClmAddress[key]) {
      mergedInvestorPositionsByInvestorAndClmAddress[key] = position;
    } else {
      mergedInvestorPositionsByInvestorAndClmAddress[key].balance += position.balance;
    }
  }
  const mergedPositions = Object.values(mergedInvestorPositionsByInvestorAndClmAddress);

  const vaultAddressWithActivePosition = uniq(investorPositions.map(pos => pos.token_address));
  const vaults = vaultConfigs.filter(
    vault =>
      vaultAddressWithActivePosition.includes(vault.vault_address) ||
      vault.reward_pools.some(pool =>
        vaultAddressWithActivePosition.includes(pool.reward_pool_address)
      )
  );
  // get breakdowns for all vaults
  logger.debug({
    msg: 'Fetching breakdowns',
    vaults: vaults.length,
    blockNumber,
    chainId,
  });
  const breakdowns = await getVaultBreakdowns(chainId, BigInt(blockNumber), vaults);
  logger.debug({ msg: 'Fetched breakdowns', breakdowns: breakdowns.length });

  const breakdownByVaultAddress = breakdowns.reduce(
    (acc, breakdown) => {
      acc[breakdown.vault.vault_address.toLowerCase() as Hex] = breakdown;
      return acc;
    },
    {} as Record<Hex, BeefyVaultBreakdown>
  );

  // merge by investor address and token address
  const investorTokenBalances: Record<
    Hex /* investor */,
    Record<
      Hex /* token */,
      {
        balance: bigint /* amount */;
        details: {
          vault_id: string;
          vault_address: string;
          contribution: bigint;
        }[];
      }
    >
  > = {};
  for (const position of mergedPositions) {
    const breakdown = breakdownByVaultAddress[position.token_address];
    if (!breakdown) {
      // some test vaults were never available in the api
      continue;
    }

    if (breakdown.isLiquidityEligible === false) {
      // skip non-eligible vaults
      continue;
    }

    if (!investorTokenBalances[position.user_address]) {
      investorTokenBalances[position.user_address] = {};
    }

    for (const breakdownBalance of breakdown.balances) {
      if (!investorTokenBalances[position.user_address][breakdownBalance.tokenAddress]) {
        investorTokenBalances[position.user_address][breakdownBalance.tokenAddress] = {
          balance: BigInt(0),
          details: [],
        };
      }

      const breakdownContribution =
        (position.balance * breakdownBalance.vaultBalance) / breakdown.vaultTotalSupply;
      investorTokenBalances[position.user_address][breakdownBalance.tokenAddress].balance +=
        breakdownContribution;
      investorTokenBalances[position.user_address][breakdownBalance.tokenAddress].details.push({
        vault_id: breakdown.vault.id,
        vault_address: breakdown.vault.vault_address,
        contribution: breakdownContribution,
      });
    }
  }

  // format output
  return Object.entries(investorTokenBalances).flatMap(([investor, balances]) =>
    Object.entries(balances).map(([token, balance]) => ({
      block_number: blockNumber,
      user_address: investor as Hex,
      token_address: token as Hex,
      token_balance: balance,
    }))
  );
};
