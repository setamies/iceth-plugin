// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ERC20Mock.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

library PreciseUnitMath {
    using SafeMath for uint256;

    // The number One in precise units.
    uint256 internal constant PRECISE_UNIT = 10**18;
    int256 internal constant PRECISE_UNIT_INT = 10**18;

    // Max unsigned integer value
    uint256 internal constant MAX_UINT_256 = type(uint256).max;
    // Max and min signed integer value
    int256 internal constant MAX_INT_256 = type(int256).max;
    int256 internal constant MIN_INT_256 = type(int256).min;

    /**
     * @dev Getter function since constants can't be read directly from libraries.
     */
    function preciseUnit() internal pure returns (uint256) {
        return PRECISE_UNIT;
    }

    /**
     * @dev Getter function since constants can't be read directly from libraries.
     */
    function preciseUnitInt() internal pure returns (int256) {
        return PRECISE_UNIT_INT;
    }
}

contract IcETHMock is ERC20Mock {
    event PositionMultiplierEdited(int256 _newMultiplier);
    int256 public positionMultiplier;
    using PreciseUnitMath for int256;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {
        positionMultiplier = PreciseUnitMath.preciseUnitInt();
    }

    function editPositionMultiplier(int256 _newMultiplier) external {
        positionMultiplier = _newMultiplier;

        emit PositionMultiplierEdited(_newMultiplier);
    }
}
