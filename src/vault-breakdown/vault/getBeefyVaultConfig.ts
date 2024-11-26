import { groupBy } from 'lodash';
import type { Hex } from 'viem';
import type { ChainId } from '../../config/chains';

import { getWNativeToken, isNativeToken } from '../../utils/addressbook';
import { getAsyncCache } from '../../utils/async-lock';
import { FriendlyError } from '../../utils/error';
import {
  BEEFY_BOOST_API,
  BEEFY_COW_VAULT_API,
  BEEFY_GOV_API,
  BEEFY_MOO_VAULT_API,
} from '../config';

export type BeefyVault = {
  id: string;
  vault_address: Hex;
  undelying_lp_address: Hex;
  strategy_address: Hex;
  vault_token_symbol: string;
  chain: string;
  reward_pools: BeefyRewardPool[];
  boosts: BeefyBoost[];
  pointStructureIds: string[];
  platformId: ApiPlatformId;
  status: 'active' | 'eol';
} & (
  | {
      protocol_type: 'beefy_clm_vault';
      beefy_clm_manager: BeefyVault;
    }
  | {
      protocol_type: Exclude<BeefyProtocolType, 'beefy_clm_vault'>;
    }
);

export type BeefyRewardPool = {
  id: string;
  clm_address: Hex;
  reward_pool_address: Hex;
};

export type BeefyBoost = {
  id: string;
  boost_address: Hex;
  underlying_address: Hex;
};

export type BeefyProtocolType =
  | 'aave'
  | 'balancer_aura'
  | 'beefy_clm_vault'
  | 'beefy_clm'
  | 'curve'
  | 'gamma'
  | 'ichi'
  | 'pendle_equilibria'
  | 'solidly';

type ApiPlatformId =
  | 'aerodrome'
  | 'aura'
  | 'beefy'
  | 'curve'
  | 'equilibria'
  | 'gamma'
  | 'ichi'
  | 'lendle'
  | 'lynex'
  | 'magpie'
  | 'mendi'
  | 'nile'
  | 'velodrome';

export type ApiStrategyTypeId = 'lp' | 'multi-lp' | 'multi-lp-locked' | 'cowcentrated';

export type ApiVault = {
  id: string;
  name: string;
  status: 'active' | 'eol';
  earnedTokenAddress: string;
  depositTokenAddresses?: string[];
  chain: string;
  platformId: ApiPlatformId;
  token: string;
  tokenAddress?: string;
  earnedToken: string;
  isGovVault?: boolean;
  strategyTypeId?: ApiStrategyTypeId;
  bridged?: object;
  assets?: string[];
  strategy: Hex;
  pointStructureIds?: string[];
};

export type ApiClmManager = {
  id: string;
  name: string;
  status: 'active' | 'eol';
  version: number;
  platformId: ApiPlatformId;
  strategyTypeId?: ApiStrategyTypeId;
  earnedToken: string;
  strategy: string;
  chain: string;
  type: 'cowcentrated' | 'others';
  tokenAddress: string; // underlying pool address
  depositTokenAddresses: string[]; // token0 and token1
  earnContractAddress: string; // reward pool address
  earnedTokenAddress: string; // clm manager address
  pointStructureIds?: string[];
};

export type ApiClmRewardPool = {
  id: string;
  status: 'active' | 'eol';
  version: number;
  platformId: ApiPlatformId;
  strategyTypeId?: ApiStrategyTypeId;
  chain: string;
  tokenAddress: string; // clm address (want)
  earnContractAddress: string; // reward pool address
  earnedTokenAddresses: string[]; // reward tokens
};

export type ApiGovVault = {
  id: string;
  status: 'active' | 'eol';
  version: number;
  chain: string;
  tokenAddress: string; // clm address
  earnContractAddress: string; // reward pool address
  earnedTokenAddresses: string[];
};

export type ApiBoost = {
  id: string;
  poolId: string;

  version: number;
  chain: string;
  status: 'active' | 'eol';

  tokenAddress: string; // underlying
  earnedTokenAddress: string; // reward token address
  earnContractAddress: string; // reward pool address
};

const protocol_map: Record<ApiPlatformId, BeefyProtocolType> = {
  aerodrome: 'solidly',
  aura: 'balancer_aura',
  beefy: 'beefy_clm',
  curve: 'curve',
  equilibria: 'pendle_equilibria',
  gamma: 'gamma',
  ichi: 'ichi',
  lendle: 'aave',
  lynex: 'solidly',
  magpie: 'pendle_equilibria',
  mendi: 'aave',
  nile: 'solidly',
  velodrome: 'solidly',
};

export const getBeefyVaultConfig = async (
  chain: ChainId,
  vaultFilter: (vault: BeefyVault) => boolean
): Promise<BeefyVault[]> => {
  const asyncCache = getAsyncCache();
  const allConfigs = await asyncCache.wrap(`beefy-vault-config:${chain}`, 5 * 60 * 1000, () =>
    getAllConfigs(chain)
  );
  const filteredConfigs = allConfigs.filter(vaultFilter);
  return filteredConfigs;
};

export const getBeefyBreakdownableVaultConfig = async (
  chain: ChainId,
  vaultFilter: (vault: BeefyVault) => boolean
): Promise<BeefyVault[]> => {
  const asyncCache = getAsyncCache();
  const allConfigs = await asyncCache.wrap(`beefy-vault-config:${chain}`, 5 * 60 * 1000, () =>
    getAllConfigs(chain)
  );
  const filteredConfigs = allConfigs.filter(vaultFilter);

  // check for undefined protocol types
  const notFoundProtocols = filteredConfigs.filter(v => !v.protocol_type);
  if (notFoundProtocols.length > 0) {
    const messages = notFoundProtocols.map(
      v =>
        `Unknown platformId ${v.platformId} for vault ${v.id}. Devs need to implement breakdown for this protocol`
    );
    throw new FriendlyError(messages.join('\n'));
  }

  return filteredConfigs;
};

const getAllConfigs = async (chain: ChainId): Promise<BeefyVault[]> => {
  const [cowVaultsData, mooVaultsData, clmRewardPoolData, [boostData, vaultRewardPoolData]] =
    await Promise.all([
      fetch(`${BEEFY_COW_VAULT_API}/${chain}`)
        .then(res => res.json())
        .then(res => (res as ApiClmManager[]).filter(vault => vault.chain === chain)),
      fetch(`${BEEFY_MOO_VAULT_API}/${chain}`)
        .then(res => res.json())
        .then(res =>
          (res as ApiVault[])
            .filter(vault => vault.chain === chain)
            .filter(vault => vault.isGovVault !== true)
        ),
      fetch(`${BEEFY_GOV_API}/${chain}`)
        .then(res => res.json())
        .then(res =>
          (res as ApiClmRewardPool[]).filter(g => g.chain === chain).filter(g => g.version === 2)
        ),
      fetch(`${BEEFY_BOOST_API}/${chain}`)
        .then(res => res.json())
        .then(res => [
          (res as ApiBoost[]).filter(g => g.chain === chain).filter(g => g.version !== 2),
          (res as ApiBoost[]).filter(g => g.chain === chain).filter(g => g.version === 2),
        ]),
    ]);

  const clmManagerAddresses = new Set(
    cowVaultsData.map(v => v.earnedTokenAddress.toLocaleLowerCase())
  );
  const boostPerUnderlyingAddress = groupBy(boostData, b => b.tokenAddress?.toLocaleLowerCase());
  const vaultRewardPoolDataPerVaultAddress = groupBy(vaultRewardPoolData, v =>
    v.tokenAddress.toLocaleLowerCase()
  );
  const clmRewardPoolDataPerClmAddress = groupBy(clmRewardPoolData, c =>
    c.tokenAddress.toLocaleLowerCase()
  );

  const clmVaultConfigs = cowVaultsData.map((vault): BeefyVault => {
    const undelying_lp_address = vault.tokenAddress.toLocaleLowerCase() as Hex;
    const vault_address = vault.earnedTokenAddress.toLocaleLowerCase() as Hex;

    const protocol_type: BeefyProtocolType | undefined =
      vault.type === 'cowcentrated' ? 'beefy_clm' : protocol_map[vault.platformId];
    if (protocol_type === 'beefy_clm_vault') {
      throw new FriendlyError('Invalid protocol');
    }
    const reward_pools = clmRewardPoolDataPerClmAddress[vault_address] ?? [];

    const boosts = boostPerUnderlyingAddress[vault_address] ?? [];

    return {
      id: vault.id,
      vault_address,
      chain: vault.chain,
      vault_token_symbol: vault.earnedToken,
      protocol_type,
      platformId: vault.platformId,
      status: vault.status,
      strategy_address: vault.strategy.toLocaleLowerCase() as Hex,
      undelying_lp_address,
      reward_pools: reward_pools.map(pool => ({
        id: pool.id,
        clm_address: pool.tokenAddress.toLocaleLowerCase() as Hex,
        reward_pool_address: pool.earnContractAddress.toLocaleLowerCase() as Hex,
      })),
      boosts: boosts.map(boost => ({
        id: boost.id,
        boost_address: boost.earnedTokenAddress.toLocaleLowerCase() as Hex,
        underlying_address: boost.tokenAddress.toLocaleLowerCase() as Hex,
      })),
      pointStructureIds: vault.pointStructureIds ?? [],
    };
  });

  const mooVaultCofigs = mooVaultsData.map((vault): BeefyVault => {
    let underlying_lp_address = vault.tokenAddress?.toLocaleLowerCase() as Hex | undefined;
    const vault_address = vault.earnedTokenAddress.toLocaleLowerCase() as Hex;

    if (
      !underlying_lp_address &&
      (isNativeToken(chain, vault.token) || isNativeToken(chain, vault.name))
    ) {
      const wnative = getWNativeToken(chain);
      underlying_lp_address = wnative.address as Hex;
    }

    if (!underlying_lp_address) {
      throw new FriendlyError(`Missing "tokenAddress" field for vault ${vault.id}.`);
    }

    const protocol_type: BeefyProtocolType | undefined = clmManagerAddresses.has(
      underlying_lp_address
    )
      ? 'beefy_clm_vault'
      : protocol_map[vault.platformId];

    const additionalConfig =
      protocol_type === 'beefy_clm_vault'
        ? {
            protocol_type,
            platformId: vault.platformId,
            beefy_clm_manager: clmVaultConfigs.find(
              v => v.vault_address === underlying_lp_address
            ) as BeefyVault,
          }
        : { protocol_type, platformId: vault.platformId };
    const reward_pools = vaultRewardPoolDataPerVaultAddress[vault_address] ?? [];
    const boosts = boostPerUnderlyingAddress[vault_address] ?? [];
    return {
      id: vault.id,
      vault_address,
      chain: vault.chain,
      vault_token_symbol: vault.earnedToken,
      ...additionalConfig,
      strategy_address: vault.strategy.toLocaleLowerCase() as Hex,
      undelying_lp_address: underlying_lp_address,
      status: vault.status,
      reward_pools: reward_pools.map(pool => ({
        id: pool.id,
        clm_address: pool.tokenAddress.toLocaleLowerCase() as Hex,
        reward_pool_address: pool.earnContractAddress.toLocaleLowerCase() as Hex,
      })),
      boosts: boosts.map(boost => ({
        id: boost.id,
        boost_address: boost.earnedTokenAddress.toLocaleLowerCase() as Hex,
        underlying_address: boost.tokenAddress.toLocaleLowerCase() as Hex,
      })),
      pointStructureIds: vault.pointStructureIds ?? [],
    };
  });

  const allConfigs = clmVaultConfigs.concat(mooVaultCofigs);
  return allConfigs;
};
