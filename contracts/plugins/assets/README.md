# Collateral Plugin - Set Procotol -icETH
The Interest Compounding ETH Index (icETH) is a tokenized index that enhances staking returns for ETH by using a leveraged liquid staking strategy. Built on Set Protocol's leverage token infrastructure, icETH allows holders to multiply their staking rate for stETH while minimizing transaction costs and risk associated with maintaining collateralized debt on the Aave protocol. Token holders retain spot exposure to ETH and can amplify their staking returns up to 2.5x.

By using icETH as collateral in an RToken, users can benefit from the enhanced staking yields offered by the icETH index while retaining exposure to the price movement of ETH. Additionally, using icETH as collateral can provide increased stability and security to the RToken itself.

- Gotta calculate the exhange ratio for icETH to ETH from uniswap contract
- Then get data for stETH/ETH

{tok} = icETH
{ref} = stETH
{target} = ETH
{UoA} = USD


https://dune.com/index_coop/icETH
https://dune.com/index_coop/iceth-wallet-performance

dependencies:
yarn add @uniswap/v3-sdk