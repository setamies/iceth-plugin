import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from '../individual-collateral/fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  IcETHCollateral,
  IcETHCollateralMock,
  IcETHMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  OracleLib,
  MockV3Aggregator,
  InvalidMockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  IcETHCollateral__factory,
} from '../../../typechain'
import { setOraclePrice } from '#/test/utils/oracles'

const createFixtureLoader = waffle.createFixtureLoader

// Holder addresses in Mainnet
const icethholder = '0xa400f843f0e577716493a3b0b8bc654c6ee8a8a3'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`IcETHCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let IcETH: IcETHMock
  let IcETHCollateral: IcETHCollateral

  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let deployer: TestIDeployer
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let facadeWrite: FacadeWrite
  let oracleLib: OracleLib
  let govParams: IGovParams

  // RToken Configuration
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5%
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let IcETHCollateralFactory: IcETHCollateral__factory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    IcETH = <IcETHMock>(
      await ethers.getContractAt('IcETHMock', networkConfig[chainId].tokens.ICETH || '')
    )

    IcETHCollateralFactory = await ethers.getContractFactory('IcETHCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    IcETHCollateral = <IcETHCollateral>(
      await IcETHCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        IcETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        500
      )
    )

    initialBal = bn('200e18')

    await whileImpersonating(icethholder, async (icEthSigner) => {
      await IcETH.connect(icEthSigner).transfer(addr1.address, toBNDecimals(initialBal, 18))
    })

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'ICETH RToken',
      symbol: 'rIcETH',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [],
      primaryBasket: [IcETHCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: [],
    }

    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    // Get Main
    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

    // Get core contracts
    assetRegistry = <IAssetRegistry>(
      await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
    )
    backingManager = <TestIBackingManager>(
      await ethers.getContractAt('TestIBackingManager', await main.backingManager())
    )
    basketHandler = <IBasketHandler>(
      await ethers.getContractAt('IBasketHandler', await main.basketHandler())
    )
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
    rTokenAsset = <RTokenAsset>(
      await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
    )

    // Setup owner and unpause
    await facadeWrite.connect(owner).setupGovernance(
      rToken.address,
      false, // do not deploy governance
      true, // unpaused
      govParams, // mock values, not relevant
      owner.address, // owner
      ZERO_ADDRESS, // no guardian
      ZERO_ADDRESS // no pauser
    )
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn(1e8))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Collateral correctly', async () => {
      // Check Collateral plugin
      // IcETH
      expect(await IcETHCollateral.isCollateral()).to.equal(true)
      expect(await IcETHCollateral.erc20()).to.equal(IcETH.address)
      expect(await IcETH.decimals()).to.equal(18)
      expect(await IcETHCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await IcETHCollateral.actualRefPerTok()).to.be.closeTo(fp('0.99'), fp('0.5'))

      expect(await IcETHCollateral.refPerTok()).to.be.closeTo(fp('0.9'), fp('0.02')) // 10% revenue hiding
      expect(await IcETHCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await IcETHCollateral.pricePerTarget()).to.equal(fp('1859.17'))
      expect(await IcETHCollateral.strictPrice()).to.be.closeTo(fp('1763'), fp('100')) // close to $1763.38

      expect(await IcETHCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(IcETH.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(IcETHCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(IcETHCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(IcETH.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)

      // Check RToken price
      const issueAmount: BigNumber = bn('100e18')
      await IcETH.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('2000'), fp('100'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        IcETHCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          IcETH.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          fp('0'),
          delayUntilDefault,
          500
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferemceERC20Decimals
      await expect(
        IcETHCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          ZERO_ADDRESS,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault,
          500
        )
      ).to.be.revertedWith('missing erc20')

      // Over 100% revenue hiding
      await expect(
        IcETHCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          IcETH.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault,
          10000
        )
      ).to.be.reverted
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('100e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await IcETH.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1IcETH: BigNumber = await IcETH.balanceOf(addr1.address)

      const IcETHPrice1: BigNumber = await IcETHCollateral.strictPrice() // ~ 1729 USD
      const IcETHRefPerTok1: BigNumber = await IcETHCollateral.refPerTok()

      expect(IcETHPrice1).to.be.closeTo(fp('1729.028'), fp('100'))
      expect(IcETHRefPerTok1).to.be.closeTo(fp('0.90'), fp('0.02'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )

      expect(totalAssetValue1).to.be.closeTo(issueAmount.mul(2000), fp(100))

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh IcETHCollateral manually (required)
      await IcETHCollateral.refresh()
      expect(await IcETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - No changes
      const IcETHPrice2: BigNumber = await IcETHCollateral.strictPrice()
      const IcETHRefPerTok2: BigNumber = await IcETHCollateral.refPerTok()

      // Check rates and price increase
      expect(IcETHPrice2).to.be.closeTo(IcETHPrice1, fp('50'))
      expect(IcETHRefPerTok2).to.be.closeTo(IcETHRefPerTok1, fp('0.05'))

      // Still close to the original values
      expect(IcETHPrice2).to.be.closeTo(fp('1766'), fp('100'))
      expect(IcETHRefPerTok2).to.be.closeTo(fp('0.90'), fp('0.02'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.equal(totalAssetValue1)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer IcETH Tokens should have been sent to the user
      const newBalanceAddr1IcETH: BigNumber = await IcETH.balanceOf(addr1.address)

      // Check received tokens represent - 1K (100% of basket)
      expect(newBalanceAddr1IcETH.sub(balanceAddr1IcETH)).to.be.closeTo(fp('110'), fp('10'))

      // Check remainders in Backing Manager
      expect(await IcETH.balanceOf(backingManager.address)).to.be.closeTo(fp('0'), fp('0.1'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('0'),
        fp('100')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // Only checking to see that claim call does not revert
      await expectEvents(backingManager.claimRewards(), [])
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with a feed with zero price
      const invalidPriceIcETHCollateral: IcETHCollateral = <IcETHCollateral>await (
        await ethers.getContractFactory('IcETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        IcETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        500
      )

      await setOraclePrice(invalidPriceIcETHCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidPriceIcETHCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidPriceIcETHCollateral.refresh()
      expect(await invalidPriceIcETHCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())
      await expect(invalidPriceIcETHCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await IcETHCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status DISABLED
      console.log('reverts here?')
      await IcETHCollateral.refresh() //! Prob
      console.log('gets here?')
      expect(await IcETHCollateral.status()).to.equal(CollateralStatus.IFFY)
      await advanceBlocks(delayUntilDefault.mul(60))
      await IcETHCollateral.refresh()
      expect(await IcETHCollateral.status()).to.equal(CollateralStatus.DISABLED)

      const nonPriceIcETHCollateral: IcETHCollateral = <IcETHCollateral>await (
        await ethers.getContractFactory('IcETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        IcETH.address,
        config.rTokenMaxTradeVolume.toString(),
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        500
      )
      // Collateral with no price info should revert
      await expect(nonPriceIcETHCollateral.strictPrice()).to.be.reverted

      expect(await nonPriceIcETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // No soft default scenarios to be tested

    // Test for hard default
    // This should never happen as ratio() aETHc is nondecrasing over time,
    // But it is tested anyways.
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a AETHc mock to be able to change the rate
      const IcETHMockFactory: ContractFactory = await ethers.getContractFactory('IcETHMock')
      const IcETHMock: IcETHMock = <IcETHMock>await IcETHMockFactory.deploy('IcETH', 'icETH')

      // Redeploy plugin using the new aETHc mock
      const newIcETHCollateral: IcETHCollateralMock = <IcETHCollateralMock>await (
        await ethers.getContractFactory('IcETHCollateralMock', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        (await networkConfig[chainId].chainlinkFeeds.ETH) as string,
        (await networkConfig[chainId].chainlinkFeeds.STETH) as string,
        IcETHMock.address,
        await IcETHCollateral.maxTradeVolume(),
        await IcETHCollateral.oracleTimeout(),
        await IcETHCollateral.targetName(),
        await IcETHCollateral.defaultThreshold(),
        await IcETHCollateral.delayUntilDefault(),
        500
      )

      // Set initial ratio to 1
      await newIcETHCollateral.updateRatio(fp('1'))
      await expect(newIcETHCollateral.refresh())

      // Check initial state
      expect(await newIcETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newIcETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      await newIcETHCollateral.updateRatio(fp('0.5'))

      // Force updates
      await expect(newIcETHCollateral.refresh())
        .to.emit(newIcETHCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newIcETHCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newIcETHCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })
  })
})
