import { getContract } from 'viem';
import type { BeefyViemClient } from '../../../utils/viemClient';
import { BeefyVaultV7Abi } from '../../abi/BeefyVaultV7Abi';
import { PendleMarketAbi } from '../../abi/PendleMarket';
import { PendleSyTokenAbi } from '../../abi/PendleSyToken';
import type { BeefyVault } from '../../vault/getBeefyVaultConfig';
import type { BeefyVaultBreakdown } from '../types';

// https://etherscan.io/address/0x00000000005BBB0EF59571E58418F9a4357b68A0
// https://arbiscan.io/address/0x00000000005BBB0EF59571E58418F9a4357b68A0
const PENDLE_ROUTER_ADDRESS = '0x00000000005BBB0EF59571E58418F9a4357b68A0';

export const getPendleVaultBreakdown = async (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
): Promise<BeefyVaultBreakdown> => {
  const vaultContract = getContract({
    client,
    address: vault.vault_address,
    abi: BeefyVaultV7Abi,
  });

  const pendleMarketContract = getContract({
    client,
    address: vault.undelying_lp_address,
    abi: PendleMarketAbi,
  });

  const vaultWantBalance = await vaultContract.read.balance({ blockNumber });
  const vaultTotalSupply = await vaultContract.read.totalSupply({ blockNumber });
  const tokenAddresses = await pendleMarketContract.read.readTokens({ blockNumber });
  const pendleState = await pendleMarketContract.read.readState([PENDLE_ROUTER_ADDRESS], {
    blockNumber,
  });

  const syTokenContract = getContract({
    client,
    address: tokenAddresses[0],
    abi: PendleSyTokenAbi,
  });

  const syUnderlyingAddress = await syTokenContract.read.yieldToken({ blockNumber });

  return {
    vault,
    blockNumber,
    vaultTotalSupply,
    isLiquidityEligible: true,
    balances: [
      {
        tokenAddress: syUnderlyingAddress,
        vaultBalance: (pendleState.totalSy * vaultWantBalance) / pendleState.totalLp,
      },
    ],
  };
};
