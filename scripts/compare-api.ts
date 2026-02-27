/**
 * Compare balance API responses: localhost vs production.
 * Run with: npm run compare:api (ensure local server is running on localhost:4000)
 *
 * Compares responses with: unordered arrays, extra fields allowed.
 */

import { allChainIds } from '../src/config/chains';

const LOCAL_BASE = process.env.LOCAL_API ?? 'http://localhost:4000';
const PROD_BASE = process.env.PROD_API ?? 'https://balance-api.beefy.finance';
const BEEFY_API = 'https://api.beefy.finance';
// Max 0.5 rps to prod => 2000ms between prod requests (override with REQUEST_DELAY_MS)
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 2000);
const QUICK = process.env.QUICK === '1' || process.env.QUICK === 'true';
const CHAIN_FILTER = process.env.CHAINS ? process.env.CHAINS.split(',').map(s => s.trim()) : null;

// ---------- Comparison ----------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys where we only require presence in local, not same value (e.g. block metadata that varies by run). */
const IGNORE_VALUE_KEYS = new Set(['number', 'timestamp']);

/**
 * True if local is a superset of prod: all keys from prod are present in local with the same value.
 * For arrays: each prod element must have at least one matching local element (one match is enough).
 * Keys in IGNORE_VALUE_KEYS only require presence in local, not value equality.
 */
function localIsSupersetOfProd(local: unknown, prod: unknown): boolean {
  if (local === prod) return true;
  if (typeof local !== 'object' || local === null || typeof prod !== 'object' || prod === null) {
    return local === prod;
  }
  if (Array.isArray(local) && Array.isArray(prod)) {
    for (const pItem of prod) {
      const found = (local as unknown[]).some(lItem => localIsSupersetOfProd(lItem, pItem));
      if (!found) return false;
    }
    return true;
  }
  if (Array.isArray(local) !== Array.isArray(prod)) return false;
  const localObj = local as Record<string, unknown>;
  const prodObj = prod as Record<string, unknown>;
  for (const key of Object.keys(prodObj)) {
    if (!Object.prototype.hasOwnProperty.call(localObj, key)) return false;
    if (IGNORE_VALUE_KEYS.has(key)) continue;
    if (!localIsSupersetOfProd(localObj[key], prodObj[key])) return false;
  }
  return true;
}

/** Compare responses: local must be superset of prod (same keys/values from prod, local can have more). */
function responsesMatch(localBody: unknown, prodBody: unknown): boolean {
  return localIsSupersetOfProd(localBody, prodBody);
}

// ---------- Fetcher ----------

async function fetchJson(
  base: string,
  path: string,
  query?: string
): Promise<{ status: number; body: unknown; error?: string }> {
  const url = query ? `${base}${path}?${query}` : `${base}${path}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { status: -1, body: null, error: err };
  }
}

// ---------- Harvestable vaults ----------

type HarvestableVault = {
  id: string;
  earnContractAddress?: string;
  strategy?: string;
  chain?: string;
  status?: string;
};

async function getHarvestableVaults(chain: string): Promise<HarvestableVault[]> {
  const url = `${BEEFY_API}/harvestable-vaults/${chain}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = await res.json();

    const vaults = Array.isArray(data) ? data : [];
    const excludedVaults = [
      '0x01793ef258B053E86e3dF3D6A6786867De12c1B1',
      '0x01793ef258B053E86e3dF3D6A6786867De12c1B1',
      '0x0165384487d26b3bb71aE2f3e26635071b71CC25',
    ].map(v => v.toLowerCase());

    const filteredVaults = vaults.filter(
      v => !excludedVaults.includes(v.earnContractAddress?.toLowerCase() ?? '')
    );
    return filteredVaults;
  } catch {
    return [];
  }
}

function pickVaultsForChain(vaults: HarvestableVault[]): {
  vaultId: string;
  vaultAddress: string;
  strategyAddress: string;
} | null {
  const withAll = vaults.filter(
    v => v.id && v.earnContractAddress && v.strategy && (v.status === 'active' || !v.status)
  );
  const v = withAll[0];
  if (!v?.id || !v.earnContractAddress || !v.strategy) return null;
  return {
    vaultId: v.id,
    vaultAddress: v.earnContractAddress,
    strategyAddress: v.strategy,
  };
}

// Take first N vaults that have id and earnContractAddress
function pickVaultsForChainSafe(vaults: HarvestableVault[], max: number): HarvestableVault[] {
  const withAddress = vaults.filter(v => v.id && v.earnContractAddress);
  return withAddress.slice(0, max);
}

// ---------- Test matrix ----------

const HOLDER_ADDRESSES = [
  '0x0481ad5b536139472af5ce692330dbf00bbd8672',
  '0x16c2b704bd087719e5a30e13d818b8f40d20c88c',
];

// Chain -> two block numbers for “multiple blocks” tests
const BLOCKS_BY_CHAIN: Record<string, [number, number]> = {
  arbitrum: [279181618, 279181600],
  base: [20449610, 20449600],
  ethereum: [24530262, 24440262],
  bsc: [83441104, 82451104],
  polygon: [83389418, 73489418],
  optimism: [148150075, 148050075],
  avax: [79024616, 79014616],
  fantom: [70000000, 69999000],
  gnosis: [44855047, 42855047],
  linea: [29101345, 29001345],
  scroll: [30823913, 30813913],
  zksync: [68771999, 68780999],
  mantle: [91984369, 91884369],
  metis: [22238004, 22228004],
  moonbeam: [14608332, 14617332],
  fraxtal: [32544201, 32344201],
  berachain: [17532210, 17522210],
  manta: [7393154, 7392154],
  mode: [35955798, 35945798],
  rootstock: [8568545, 8558545],
  sei: [195631029, 195621029],
  sonic: [63759281, 63729281],
  hyperevm: [28305867, 21305867],
  lisk: [27818399, 27808399],
  megaeth: [9301248, 9300248],
  monad: [57876966, 57866966],
  plasma: [15165530, 15162530],
  saga: [10520230, 10510230],
};

function getBlocks(chain: string): [number, number] {
  return BLOCKS_BY_CHAIN[chain] ?? [0, 0];
}

function getAllChains(): string[] {
  const chains = allChainIds as string[];
  if (CHAIN_FILTER && CHAIN_FILTER.length > 0) {
    return chains.filter(c => CHAIN_FILTER.includes(c));
  }
  if (QUICK) return ['arbitrum', 'base', 'ethereum'];
  return chains;
}

type TestCase = { name: string; path: string; query?: string };

async function buildTestCases(): Promise<TestCase[]> {
  const cases: TestCase[] = [];

  // No-param endpoints
  cases.push({ name: 'GET /api/v1/status', path: '/api/v1/status' });
  cases.push({ name: 'GET /api/v1/holders/counts/all', path: '/api/v1/holders/counts/all' });
  for (const addr of HOLDER_ADDRESSES.slice(0, QUICK ? 1 : 2)) {
    cases.push({
      name: `GET /api/v1/holders/${addr}/latest-balances`,
      path: `/api/v1/holders/${addr}/latest-balances`,
    });
  }

  cases.push({
    name: 'GET contract share-tokens-balances arbitrum 0x02dB67... 279181600',
    path: '/api/v1/contract/arbitrum/0x02dB67e732748027293C2eaeb21C949d8DF3F6a8/279181600/share-tokens-balances',
  });

  const chains = getAllChains();

  for (const chain of chains) {
    cases.push({ name: `GET config/vaults ${chain}`, path: `/api/v1/config/${chain}/vaults` });
    cases.push({
      name: `GET config/vaults ${chain} include_eol`,
      path: `/api/v1/config/${chain}/vaults`,
      query: 'include_eol=true',
    });
    cases.push({ name: `GET config/bundles ${chain}`, path: `/api/v1/config/${chain}/bundles` });

    cases.push({
      name: `GET partner/camelot/config/bundles ${chain}`,
      path: `/api/v1/partner/camelot/config/${chain}/bundles`,
    });

    const [block1, block2] = getBlocks(chain);
    if (block1 && block2) {
      cases.push({
        name: `GET partner/balancer/config ${chain} ${block1}`,
        path: `/api/v1/partner/balancer/config/${chain}/${block1}/bundles`,
      });
      cases.push({
        name: `GET partner/balancer/config ${chain} ${block2}`,
        path: `/api/v1/partner/balancer/config/${chain}/${block2}/bundles`,
      });
    }

    const vaults = await getHarvestableVaults(chain);
    const picked = pickVaultsForChainSafe(vaults, 2);
    const oneVault = pickVaultsForChain(vaults);

    const contractAddresses = picked.map(v => v.earnContractAddress).filter(Boolean) as string[];
    if (contractAddresses.length > 0) {
      const q = new URLSearchParams();
      contractAddresses.forEach(a => q.append('contract_addresses', a));
      q.set('limit', '10');
      cases.push({
        name: `GET contract/top-holders ${chain}`,
        path: `/api/v1/contract/${chain}/top-holders`,
        query: q.toString(),
      });
    }

    for (const vault of picked.slice(0, QUICK ? 1 : 2)) {
      if (!vault.id || !block1) continue;
      cases.push({
        name: `GET vault share-tokens-balances ${chain} ${vault.id} ${block1}`,
        path: `/api/v1/vault/${chain}/${vault.id}/${block1}/share-tokens-balances`,
      });
      cases.push({
        name: `GET vault bundle-holder-share ${chain} ${vault.id} ${block1}`,
        path: `/api/v1/vault/${chain}/${vault.id}/${block1}/bundle-holder-share`,
      });
      if (block2) {
        cases.push({
          name: `GET vault share-tokens-balances ${chain} ${vault.id} ${block2}`,
          path: `/api/v1/vault/${chain}/${vault.id}/${block2}/share-tokens-balances`,
        });
      }
    }

    if (oneVault?.vaultAddress && block1) {
      cases.push({
        name: `GET vault bundle-holder-share-by-vault-address ${chain} ${block1}`,
        path: `/api/v1/vault/${chain}/${oneVault.vaultAddress}/${block1}/bundle-holder-share-by-vault-address`,
      });
      if (block2) {
        cases.push({
          name: `GET vault bundle-holder-share-by-vault-address ${chain} ${block2}`,
          path: `/api/v1/vault/${chain}/${oneVault.vaultAddress}/${block2}/bundle-holder-share-by-vault-address`,
        });
      }
    }
    if (oneVault?.strategyAddress && block1) {
      cases.push({
        name: `GET vault bundle-holder-share-by-strategy-address ${chain} ${block1}`,
        path: `/api/v1/vault/${chain}/${oneVault.strategyAddress}/${block1}/bundle-holder-share-by-strategy-address`,
      });
    }

    if (contractAddresses.length > 0 && block1) {
      const addr = contractAddresses[0];
      cases.push({
        name: `GET contract share-tokens-balances ${chain} ${addr} ${block1}`,
        path: `/api/v1/contract/${chain}/${addr}/${block1}/share-tokens-balances`,
      });
      if (block2) {
        cases.push({
          name: `GET contract share-tokens-balances ${chain} ${addr} ${block2}`,
          path: `/api/v1/contract/${chain}/${addr}/${block2}/share-tokens-balances`,
        });
      }
    }
  }

  // README: vault top-holders (may 404 locally)
  for (const chain of chains.slice(0, QUICK ? 1 : 3)) {
    const vaults = await getHarvestableVaults(chain);
    const addrs = pickVaultsForChainSafe(vaults, 2)
      .map(v => v.earnContractAddress)
      .filter((a): a is string => Boolean(a));
    if (addrs.length > 0) {
      const q = new URLSearchParams();
      addrs.forEach(a => q.append('vault_addresses', a));
      q.set('limit', '1');
      cases.push({
        name: `GET vault/top-holders ${chain} (may 404)`,
        path: `/api/v1/vault/${chain}/top-holders`,
        query: q.toString(),
      });
    }
  }

  return cases;
}

// ---------- Main ----------

const CONTRACT_SHARE_TOKENS_BALANCES_PATH =
  /^\/api\/v1\/contract\/([^/]+)\/(0x[a-fA-F0-9]+)\/(\d+)\/share-tokens-balances$/;

function isNoContractBalancesError(body: unknown): boolean {
  if (!isPlainObject(body) || typeof (body as Record<string, unknown>).error !== 'string')
    return false;
  return ((body as Record<string, unknown>).error as string).includes('No contract balances found');
}

function buildUrl(base: string, path: string, query?: string): string {
  return query ? `${base}${path}?${query}` : `${base}${path}`;
}

type FetchResult = {
  path: string;
  localRes: Awaited<ReturnType<typeof fetchJson>>;
  prodRes: Awaited<ReturnType<typeof fetchJson>>;
  localUrl: string;
  prodUrl: string;
  noContractFound?: true;
};

async function fetchWithContractRetry(
  path: string,
  query: string | undefined,
  localBase: string,
  prodBase: string
): Promise<FetchResult> {
  const localRes = await fetchJson(localBase, path, query);
  await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  const prodRes = await fetchJson(prodBase, path, query);

  const match = path.match(CONTRACT_SHARE_TOKENS_BALANCES_PATH);
  if (!match || prodRes.status !== 200 || !isNoContractBalancesError(prodRes.body)) {
    return {
      path,
      localRes,
      prodRes,
      localUrl: buildUrl(localBase, path, query),
      prodUrl: buildUrl(prodBase, path, query),
    };
  }

  const [, chain, currentAddress, block] = match;
  const vaults = await getHarvestableVaults(chain);
  const candidates = pickVaultsForChainSafe(vaults, 10)
    .map(v => v.earnContractAddress)
    .filter((a): a is string => a != null && a.toLowerCase() !== currentAddress.toLowerCase());

  for (let i = 0; i < Math.min(5, candidates.length); i++) {
    const altAddress = candidates[i];
    if (!altAddress) continue;
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    const altPath = `/api/v1/contract/${chain}/${altAddress}/${block}/share-tokens-balances`;
    const altLocal = await fetchJson(localBase, altPath, query);
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    const altProd = await fetchJson(prodBase, altPath, query);
    if (altProd.status === 200 && !isNoContractBalancesError(altProd.body)) {
      return {
        path: altPath,
        localRes: altLocal,
        prodRes: altProd,
        localUrl: buildUrl(localBase, altPath, query),
        prodUrl: buildUrl(prodBase, altPath, query),
      };
    }
  }

  return {
    path,
    localRes,
    prodRes,
    localUrl: buildUrl(localBase, path, query),
    prodUrl: buildUrl(prodBase, path, query),
    noContractFound: true,
  };
}

async function runOne(
  tc: TestCase,
  localBase: string,
  prodBase: string
): Promise<{ ok: boolean; detail: string; localUrl?: string; prodUrl?: string }> {
  const { path, localRes, prodRes, localUrl, prodUrl, noContractFound } =
    await fetchWithContractRetry(tc.path, tc.query, localBase, prodBase);

  const fail = (detail: string) => ({ ok: false as const, detail, localUrl, prodUrl });

  if (noContractFound) return fail('No contract with balances found on prod (tried alternatives)');
  if (localRes.error) return fail(`Local error: ${localRes.error}`);
  if (prodRes.error) return fail(`Prod error: ${prodRes.error}`);
  if (localRes.status !== prodRes.status)
    return fail(`Status mismatch: local ${localRes.status} vs prod ${prodRes.status}`);
  if (localRes.status < 200 || localRes.status >= 300)
    return { ok: true, detail: `Both ${localRes.status} (no body compare)` };
  if (responsesMatch(localRes.body, prodRes.body)) return { ok: true, detail: 'OK' };
  return fail('Body mismatch');
}

async function main(): Promise<void> {
  console.log('Building test cases...');
  const cases = await buildTestCases();
  console.log(`Running ${cases.length} cases (local: ${LOCAL_BASE}, prod: ${PROD_BASE})`);
  if (QUICK) console.log('(QUICK mode: fewer chains/addresses)');
  if (CHAIN_FILTER) console.log('(CHAIN_FILTER:', CHAIN_FILTER.join(','), ')');

  let passed = 0;
  let failed = 0;
  const failures: { name: string; detail: string; localUrl?: string; prodUrl?: string }[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    if (!tc) throw new Error(`Case ${i} is undefined`);
    const result = await runOne(tc, LOCAL_BASE, PROD_BASE);
    if (result.ok) {
      passed++;
      console.log(`  [${i + 1}/${cases.length}] PASS ${tc.name}`);
    } else {
      failed++;
      console.log(`  [${i + 1}/${cases.length}] FAIL ${tc.name}: ${result.detail}`);
      if (result.localUrl != null && result.prodUrl != null) {
        console.log(`      local: ${result.localUrl}`);
        console.log(`      prod:  ${result.prodUrl}`);
      }
      failures.push({
        name: tc.name,
        detail: result.detail,
        localUrl: result.localUrl,
        prodUrl: result.prodUrl,
      });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Passed: ${passed}, Failed: ${failed}, Total: ${cases.length}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => {
      console.log(`  - ${f.name}: ${f.detail}`);
      if (f.localUrl != null && f.prodUrl != null) {
        console.log(`    local: ${f.localUrl}`);
        console.log(`    prod:  ${f.prodUrl}`);
      }
    });
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
