// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/IUniswapV3Pool.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title GoldfinchSeniorPoolCollateral
 * @notice Collateral plugin for a Goldfinch Senior Pool tokens
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract IcETHCollateral is RevenueHiding {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;
    // using SafeMath for uint256;

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
        address weth,
        address factory,
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
        chainlinkFeed = chainlinkFeed_;
        stETHFeed = stETHFeed_;
    }

    // @return {ref/tok}
    function actualRefPerTok() public view override returns (uint192) {
        uint256 ref = stETHFeed.price(oracleTimeout);
        uint256 newref = ref.mul(IUniswapV3Pool(address(erc20)).calculatePriceFromLiquidity());
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
}
