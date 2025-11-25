# beefy-balances-api


Access api for the CLM subgraph: https://github.com/beefyfinance/beefy-balances-subgraph

## add a new chain

- Add the chain to `src/config/chains.ts`
- `npm run update:addressbook` 
- update `src/utils/viemClient.ts`
- `npm run test:ts` and fix errs
- `npm run format:fix`
- `npm run dev` 
    - http://localhost:4000/api/v1/status
    - http://localhost:4000/api/v1/holders/counts/all
    - http://localhost:4000/api/v1/config/:chain/vaults
    - http://localhost:4000/api/v1/contract/:chain/:vault_address/:block_number/share-tokens-balances
    - http://localhost:4000/api/v1/holders/0x16c2b704bd087719e5a30e13d818b8f40d20c88c/latest-balances
    
    
## Deploy the api

- `npm run deploy` to deploy the api


# Test urls
```
https://balance-api.beefy.finance/api/v1/status
http://localhost:4000/api/v1/status

https://balance-api.beefy.finance/api/v1/holders/counts/all
http://localhost:4000/api/v1/holders/counts/all

https://balance-api.beefy.finance/api/v1/holders/0x0481ad5b536139472af5ce692330dbf00bbd8672/latest-balances
http://localhost:4000/api/v1/holders/0x0481ad5b536139472af5ce692330dbf00bbd8672/latest-balances

https://balance-api.beefy.finance/api/v1/contract/arbitrum/top-holders?contract_addresses=0x0481ad5b536139472af5ce692330dbf00bbd8672&contract_addresses=0x0d1f71170d93121b48a9e8fc7400e8e6a6821500&limit=10
http://localhost:4000/api/v1/contract/arbitrum/top-holders?contract_addresses=0x0481ad5b536139472af5ce692330dbf00bbd8672&contract_addresses=0x0d1f71170d93121b48a9e8fc7400e8e6a6821500&limit=10

https://balance-api.beefy.finance/api/vbundle-holder-share1/vault/base/baseswap-cow-weth-cbbtc/20449610/share-tokens-balances
http://localhost:4000/api/v1/vault/base/baseswap-cow-weth-cbbtc/20449610/share-tokens-balances

https://balance-api.beefy.finance/api/v1/contract/base/0xc978f4e6fba86ca3a25c864a48476f0deca908e1/20449610/share-tokens-balances
http://localhost:4000/api/v1/contract/base/0xc978f4e6fba86ca3a25c864a48476f0deca908e1/20449610/share-tokens-balances

https://balance-api.beefy.finance/api/v1/config/arbitrum/vaults
http://localhost:4000/api/v1/config/arbitrum/vaults

https://balance-api.beefy.finance/api/v1/config/arbitrum/vaults?include_eol=true
http://localhost:4000/api/v1/config/arbitrum/vaults?include_eol=true


https://balance-api.beefy.finance/api/v1/config/arbitrum/bundles
http://localhost:4000/api/v1/config/arbitrum/bundles


https://balance-api.beefy.finance/api/v1/partner/camelot/config/arbitrum/bundles
http://localhost:4000/api/v1/partner/camelot/config/arbitrum/bundles

https://balance-api.beefy.finance/api/v1/vault/base/baseswap-cow-weth-cbbtc/20449610/bundle-holder-share
http://localhost:4000/api/v1/vault/base/baseswap-cow-weth-cbbtc/20449610/bundle-holder-share
https://balance-api.beefy.finance/api/v1/vault/arbitrum/camelot-order-weth/279181618/bundle-holder-share
http://localhost:4000/api/v1/vault/arbitrum/camelot-order-weth/279181618/bundle-holder-share
https://balance-api.beefy.finance/api/v1/vault/arbitrum/uniswap-cow-arb-usdc-dai-vault/279181618/bundle-holder-share
http://localhost:4000/api/v1/vault/arbitrum/uniswap-cow-arb-usdc-dai-vault/279181618/bundle-holder-share


https://balance-api.beefy.finance/api/v1/vault/base/0xb37b4fac09af8d900e15ac942a4ee1e498fa0989/20449610/bundle-holder-share-by-vault-address
http://localhost:4000/api/v1/vault/base/0xb37b4fac09af8d900e15ac942a4ee1e498fa0989/20449610/bundle-holder-share-by-vault-address
https://balance-api.beefy.finance/api/v1/vault/arbitrum/0x42cf53622b413b40cb24f78a79e0e76e587b7f33/279181618/bundle-holder-share-by-vault-address
http://localhost:4000/api/v1/vault/arbitrum/0x42cf53622b413b40cb24f78a79e0e76e587b7f33/279181618/bundle-holder-share-by-vault-address
https://balance-api.beefy.finance/api/v1/vault/arbitrum/0xf4ea976b260a498f26417b89f6dbdd555104a734/279181618/bundle-holder-share-by-vault-address
http://localhost:4000/api/v1/vault/arbitrum/0xf4ea976b260a498f26417b89f6dbdd555104a734/279181618/bundle-holder-share-by-vault-address
https://balance-api.beefy.finance/api/v1/vault/arbitrum/0xf4ea976b260a498f26417b89f6dbdd555104a734/279181618/bundle-holder-share-by-strategy-address
http://localhost:4000/api/v1/vault/arbitrum/0xf4ea976b260a498f26417b89f6dbdd555104a734/279181618/bundle-holder-share-by-strategy-address


https://balance-api.beefy.finance/api/v1/vault/arbitrum/top-holders?vault_addresses=0x0481ad5b536139472af5ce692330dbf00bbd8672&vault_addresses=0x0d1f71170d93121b48a9e8fc7400e8e6a6821500&limit=1
http://localhost:4000/api/v1/vault/arbitrum/top-holders?vault_addresses=0x0481ad5b536139472af5ce692330dbf00bbd8672&vault_addresses=0x0d1f71170d93121b48a9e8fc7400e8e6a6821500&limit=1

https://balance-api.beefy.finance/api/v1/partner/balancer/config/arbitrum/20449610/bundles
http://localhost:4000/api/v1/partner/balancer/config/arbitrum/20449610/bundles
