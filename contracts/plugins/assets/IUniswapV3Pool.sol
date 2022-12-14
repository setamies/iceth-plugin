// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// External interface for aETHc
// See: https://etherscan.io/address/0x6a9366f02b6e252e0cbe2e6b9cf0a8addd7b641c#code
interface IUniswapV3Pool is IERC20Metadata {
    function calculatePriceFromLiquidity(uint24 fee) external view returns (uint256);
}
