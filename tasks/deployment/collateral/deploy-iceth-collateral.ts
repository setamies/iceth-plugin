import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { IcETHCollateral } from '../../../typechain'

task('deploy-iceth-collateral', 'Deploys icETH Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('chainlinkFeed', 'ETH Price Feed address')
  .addParam('stETHFeed', 'STETH Price Feed address')
  .addParam('tokenAddress', 'icETH address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'default threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('allowedDropBasisPoints', 'allowed drop basis points')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const IcETHCollateralFactory = await hre.ethers.getContractFactory('IcETHCollateral', {
      libraries: { OracleLib: params.oracleLib },
    })

    const collateral = <IcETHCollateral>(
      await IcETHCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.chainlinkFeed,
        params.stETHFeed,
        params.erc20,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.defaultThreshold,
        params.delayUntilDefault,
        params.allowedDropBasisPoints
      )
    )

    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed icETH Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })