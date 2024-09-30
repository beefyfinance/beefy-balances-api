import type { ChainId } from '../../config/chains';
import { type BeefyViemClient, getViemClient } from '../../utils/viemClient';
import type { BeefyProtocolType, BeefyVault } from '../vault/getBeefyVaultConfig';
import { getAaveVaultBreakdown } from './protocol_type/aave';
import { getBalancerAuraVaultBreakdown } from './protocol_type/balancer';
import { getBeefyClmManagerBreakdown, getBeefyClmVaultBreakdown } from './protocol_type/beefy_clm';
import { getCurveVaultBreakdown } from './protocol_type/curve';
import { getGammaVaultBreakdown } from './protocol_type/gamma';
import { getPendleVaultBreakdown } from './protocol_type/pendle';
import { getSolidlyVaultBreakdown } from './protocol_type/solidly';
import type { BeefyVaultBreakdown } from './types';

type BreakdownMethod = (
  client: BeefyViemClient,
  blockNumber: bigint,
  vault: BeefyVault
) => Promise<BeefyVaultBreakdown>;

const breakdownMethods: Record<BeefyProtocolType, BreakdownMethod> = {
  aave: getAaveVaultBreakdown,
  balancer_aura: getBalancerAuraVaultBreakdown,
  beefy_clm_vault: getBeefyClmVaultBreakdown,
  beefy_clm: getBeefyClmManagerBreakdown,
  curve: getCurveVaultBreakdown,
  gamma: getGammaVaultBreakdown,
  ichi: getGammaVaultBreakdown,
  pendle_equilibria: getPendleVaultBreakdown,
  solidly: getSolidlyVaultBreakdown,
};

export const getVaultBreakdowns = async (
  chainId: ChainId,
  blockNumber: bigint,
  vaults: BeefyVault[]
): Promise<BeefyVaultBreakdown[]> => {
  // group by protocol type
  const vaultsPerProtocol: Record<BeefyProtocolType, BeefyVault[]> = vaults.reduce(
    (acc, vault) => {
      if (!acc[vault.protocol_type]) {
        acc[vault.protocol_type] = [];
      }
      acc[vault.protocol_type].push(vault);
      return acc;
    },
    {} as Record<BeefyProtocolType, BeefyVault[]>
  );

  return (
    await Promise.all(
      (Object.keys(vaultsPerProtocol) as BeefyProtocolType[]).map(async protocolType => {
        const client = getViemClient(chainId);
        const vaults = vaultsPerProtocol[protocolType];
        const getBreakdown = breakdownMethods[protocolType];
        return await Promise.all(vaults.map(vault => getBreakdown(client, blockNumber, vault)));
      })
    )
  ).flat();
};
