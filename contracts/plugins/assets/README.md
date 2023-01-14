# Collateral Plugin - Set Procotol -icETH
The Interest Compounding ETH Index (icETH) is a tokenized index that enhances staking returns for ETH by using a leveraged liquid staking strategy. Built on Set Protocol's leverage token infrastructure, icETH allows holders to multiply their staking rate for stETH while minimizing transaction costs and risk associated with maintaining collateralized debt on the Aave protocol. Token holders retain spot exposure to ETH and can amplify their staking returns up to 2.5x.

By using icETH as collateral in an RToken, users can benefit from the enhanced staking yields offered by the icETH index while retaining exposure to the price movement of ETH. Additionally, using icETH as collateral can provide increased stability and security to the RToken itself.

## Accounting units

### Collateral unit `{tok}`

icETH provides an enhanced yield on ETH using a leverage liquid staking strategy built on Set Protocol. Within Aave v2, icETH deposits Lido’s liquid staked Ethereum token—stETH—as collateral and recursively borrows ETH to procure more stETH. As a result, token holders have spot exposure to ETH and nearly twice the yield compared to simply holding stETH. It is worth noting that the effective yield for icETH is variable and subject to staking rates and borrowing costs.

Because icETH uses stETH as collateral and ETH as debt, the risk profile of the token is significantly lower than with many other leveraged strategies. This is because stETH and ETH are highly correlated. The result is lower liquidation risk and less volatility decay for icETH, enhancing fund safety and preserving NAV. Read more about icETH [here](https://indexcoop.com/blog/introducing-the-interest-compounding-eth-index)

### Reference unit `{ref}`
The reference unit is stETH. 

### Target unit `{target}` is ETH

### Unit of Account `{UoA}` is USD

## Functions 

As icETH uses a leveraged liquid staking strategy, it is possible that under certain circumstances the refPerTok() will decrease briefly, and it has happened on a few occasions in the past, for instance, when borrowing rates have been exceptionally high. However, on a longer timeframe, the value of icETH increases steadily when compared to stETH. Therefore, the plugin uses revenue hiding to protect the RToken from the temporary decrease in refPerTok().

[Exchange rate between icETH and stETH from Dune Analytics](icETHstETH.png) 

`calculatePriceFromLiquidity()` calculates the exchange rate between icETH and WETH (icETH/WETH) from Uniswapv3 [icETH/ETH pool](https://info.uniswap.org/#/pools/0xe5d028350093a743a9769e6fd7f5546eeddaa320). The exchange rate is calculated from the `sqrtPriceX96` variable from `slot0()` function of the pool. 
(https://docs.uniswap.org/sdk/v3/guides/fetching-prices)

    function calculatePriceFromLiquidity() public view returns (uint256) {
        IUniswapV3Pool pl = IUniswapV3Pool(
            IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984).getPool(
                0x7C07F7aBe10CE8e33DC6C5aD68FE033085256A84,
                0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
                500
            )
        );
        (uint160 sqrtPriceX96, , , , , , ) = pl.slot0();
        console.log("BIG BONGLE BOCKDOG", uint256(sqrtPriceX96)
        .mul(uint256(sqrtPriceX96)).mul(1e18) >> (96 * 2));
        return uint256(sqrtPriceX96).mul(uint256(sqrtPriceX96)).mul(1e18) >> (96 * 2);
    }
}


!!!!!! `actualRefPerTok()` displays the redemption rate between the collateral token and stETH. This is done by checking out the redemption rate between icETH and WETH from Uniswapv3, and multiplying that by stETH/


The price between icETH and WETH is calculated from `sqrtPriceX96`. Since both icETH and WETH have 18 decimals, the price derivation will be: 


$\pi = \frac{1}{P} \cdot 10^{12}$

$P = \left(\frac{\sqrt{\text{Price}_X \cdot 96}}{Q_{96}}\right)^2$

$Q_{96} = 2^{96}$

Where Pi is the price of icETH in terms of WETH.

`refresh()`
refresh() The function is called at the start of any significant system interaction and checks the conditions defined in Reserves Writing Collateral Plugins. After checking the conditions, it updates the status and price. It also updates maxRefPerTok if the actualRefPerTok is greater than maxRefPerTok.

In short, the conditions checked by this function are:

    If the status of the collateral is already DISABLED, the status stays DISABLED
    Reference price decrease: If refPerTok() has decreased, the status will immediately become DISABLED.
    If no reliable price data is available, the collateral status becomes IFFY.

## Tests

* Integration tests
```
 56 passing (3m)
  33 pending
```

* Yarn test:fast
```
  226 passing (8m)
  3 pending
  2 failing
  Both of the failing tests are related to Gnosis address being different than in the config file. This is a bug with Hardhat. Both of the error messages are in the end of the README file.
```

## Deployment
icETHCollateral has a deployment script in the [task](/tasks/deployment/collateral/deploy-iceth-collateral.ts) folder. One way to deploy the contract is by following the deployment [instructions](/docs/deployment.md).

* Mainnet addresses have been added to the [config file](/common/configuration.ts).
* [deploy_collateral.ts](/tasks/deployment/collateral/deploy_collateral.ts) has been updated to include the icETHCollateral.

## Relevant external contracts
* Uniswap V3 Factory: https://etherscan.io/address/0x1f98431c8ad98523631ae4a59f267346ea31f984
* Uniswap V3 icETH/WETH Pool: https://etherscan.io/address/0xe5d028350093a743A9769e6FD7F5546eEdDAA320

## Dune analytics 
https://dune.com/index_coop/icETH
https://dune.com/index_coop/iceth-wallet-performance



## Failing yarn test:fast
BrokerP0 contract #fast
       Deployment
         Should setup Broker correctly:

      AssertionError: expected '0x0b7fFc1f4AD541A4Ed16b40D8c37f092915…' to equal '0xe70f935c32dA4dB13e7876795f1e175465e…'
      + expected - actual

      -0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101
      +0xe70f935c32dA4dB13e7876795f1e175465e6458e
      
      at Context.<anonymous> (test/Broker.test.ts:96:40)
      at processTicksAndRejections (node:internal/process/task_queues:96:5)
      at runNextTicks (node:internal/process/task_queues:65:3)
      at listOnTimeout (node:internal/timers:528:9)
      at processTimers (node:internal/timers:502:7)

  2) DeployerP0 contract #fast
       Deployment
         Should setup values correctly:

      AssertionError: expected '0x0b7fFc1f4AD541A4Ed16b40D8c37f092915…' to equal '0x7580708993de7CA120E957A62f26A5dDD4b…'
      + expected - actual

      -0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101
      +0x7580708993de7CA120E957A62f26A5dDD4b3D8aC
      
      at Context.<anonymous> (test/Deployer.test.ts:225:42)
      at runMicrotasks (<anonymous>)
      at processTicksAndRejections (node:internal/process/task_queues:96:5)
      at runNextTicks (node:internal/process/task_queues:65:3)
      at listOnTimeout (node:internal/timers:528:9)
      at processTimers (node:internal/timers:502:7)

