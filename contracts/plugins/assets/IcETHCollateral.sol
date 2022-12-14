// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "hardhat/console.sol";

/**
 * @title GoldfinchSeniorPoolCollateral
 * @notice Collateral plugin for a Goldfinch Senior Pool tokens
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract IcETHCollateral is RevenueHiding {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;
    using SafeMath for uint256;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.1
    AggregatorV3Interface stETHFeed;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_, // ETH price {target = ETH}
        AggregatorV3Interface stETHFeed_, // stETH price {ref = stETH}
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        uint16 allowedDropBasisPoints_
    )
        RevenueHiding(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            allowedDropBasisPoints_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");

        require(address(erc20_) != address(0), "icETH address is missing");
        defaultThreshold = defaultThreshold_;
        AggregatorV3Interface chainlinkFeed = chainlinkFeed_;
        stETHFeed = stETHFeed_;
    }

    // @return {ref/tok}
    function actualRefPerTok() public view override returns (uint192) {
        uint256 ref = stETHFeed.price(oracleTimeout);
        // console.log("erc20", erc20);
        uint256 newref = calculatePriceFromLiquidity();
        return uint192(newref);
    }

    function checkReferencePeg() internal override {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // Check for soft default of underlying reference token
            // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
            uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;

            // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
            uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus

            if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
            else markStatus(CollateralStatus.SOUND);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }
    }

    function calculatePriceFromLiquidity() public view returns (uint256) {
        IUniswapV3Pool pl = IUniswapV3Pool(IUniswapV3Factory(
            0x1F98431c8aD98523631AE4a59f267346ea31F984)
        .getPool(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84, 
        0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 , 500));
        (uint160 sqrtPriceX96, , , , , , ) = pl.slot0();
        return uint256(sqrtPriceX96).mul(uint256(sqrtPriceX96)).mul(1e18) >> (96 * 2);
    }
}
