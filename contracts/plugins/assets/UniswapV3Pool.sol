// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract UniswapV3Pool {
    using SafeMath for uint256;

    address public factory = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address public token0 = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address public token1 = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function calculatePriceFromLiquidity(uint24 fee) public view returns (uint256) {
        IUniswapV3Pool pl = IUniswapV3Pool(IUniswapV3Factory(factory).getPool(token0, token1, fee));
        (uint160 sqrtPriceX96, , , , , , ) = pl.slot0();
        return uint256(sqrtPriceX96).mul(uint256(sqrtPriceX96)).mul(1e18) >> (96 * 2);
    }
}
