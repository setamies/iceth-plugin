// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

/**
 * @title GoldfinchSeniorPoolCollateral
 * @notice Collateral plugin for a Goldfinch Senior Pool tokens
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract IcETHCollateral is RevenueHiding {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

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
        address icETH_,
        address weth,
        uint192 allowedDropBasisPoints_
    )
        RevenueHiding(
            fallbackPrice_,
            chainlinkFeed_,
            stETHFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_,
            icETH_,
            weth,
            allowedDropBasisPoints_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");

        require(address(icETH_) != address(0), "icETH address is missing");
        defaultThreshold = defaultThreshold_;
        stETHFeed = stETHFeed_;
        chainlinkFeed = chainlinkFeed_;
        maxRefPerTok = actualRefPerTok();
        icETH = IicETH(address(erc20_));
    }

    // Calculates {WETH/icETH} from the Uniswap V3 pool
    // Can this be done cleaner?
    function calculatePriceFromLiquidity(uint24 fee) public view returns (uint256) {
        IUniswapV3Pool pool = IUniswapV3Pool(IUniswapV3Factory(factory).getPool(icETH, weth, fee));
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        uint256 amount0 = FullMath.mulDiv(pool.liquidity(), FixedPoint96.Q96, sqrtPriceX96);
        uint192 amount1 = FullMath.mulDiv(pool.liquidity(), sqrtPriceX96, FixedPoint96.Q96);
        return (amount1 * 10**ERC20(icETH).decimals()) / amount0; // Returns ETH/icETH
    }

    // @return {ref/tok}
    function actualRefPerTok() public view override returns (uint192) {
        return stETHFeed.price(oracleTimeout).mul(calculatePriceFromLiquidity());
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
