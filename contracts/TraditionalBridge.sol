// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TraditionalBridge {
    using SafeERC20 for IERC20;
    
    mapping(address => mapping(address => uint256)) public lockedBalances;
    
    function lockTokens(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        lockedBalances[msg.sender][token] += amount;
    }
    
    function unlockTokens(address token, uint256 amount) external {
        require(lockedBalances[msg.sender][token] >= amount, "Insufficient balance");
        lockedBalances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}