// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract UltraEfficientIntentBridge is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ====== EIP-712 typehashes ======
    bytes32 private constant _INTENT_TYPEHASH =
        keccak256(
            "Intent(address user,address token,uint256 amount,uint256 fee,uint256 nonce,uint256 deadline)"
        );
    bytes32 private constant _SOLVER_COMMIT_TYPEHASH =
        keccak256("SolverCommitment(bytes32 intentDigest)");
    bytes32 private constant _CANCEL_TYPEHASH =
        keccak256("Cancel(address user,uint256 nonce)");

    // ====== Storage ======
    mapping(address => uint256) public nonces;        // user => nonce
    mapping(address => uint256) public solverStakes;  // solver => staked ETH

    uint256 public constant MINIMUM_STAKE = 1 ether;

    // ====== Events ======
    event IntentFulfilled(
        address indexed user,
        address indexed solver,
        address indexed token,
        uint256 amount,
        uint256 fee
    );
    event StakeAdded(address indexed solver, uint256 amount, uint256 totalStake);
    event StakeWithdrawn(address indexed solver, uint256 amount, uint256 totalStake);

    constructor() EIP712("UltraEfficientIntentBridge", "1") {}

    // ====== Staking ======
    function stake() external payable {
        require(msg.value >= MINIMUM_STAKE, "Insufficient stake");
        solverStakes[msg.sender] += msg.value;
        emit StakeAdded(msg.sender, msg.value, solverStakes[msg.sender]);
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        uint256 bal = solverStakes[msg.sender];
        require(amount > 0 && amount <= bal, "invalid amount");
        solverStakes[msg.sender] = bal - amount;

        // Use OZ Address.sendValue instead of low-level call
        Address.sendValue(payable(msg.sender), amount);

        emit StakeWithdrawn(msg.sender, amount, solverStakes[msg.sender]);
    }

    // ====== Internal helpers (keeps stack light) ======
    function _hashIntent(
        address user,
        address token,
        uint256 amount,
        uint256 fee,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _INTENT_TYPEHASH,
                    user,
                    token,
                    amount,
                    fee,
                    nonce,
                    deadline
                )
            )
        );
    }

    function _hashSolverCommit(bytes32 intentDigest) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(_SOLVER_COMMIT_TYPEHASH, intentDigest))
        );
    }

    // ====== Fulfillment ======
    function fulfillIntent(
        address user,
        address token,
        uint256 amount,
        uint256 fee,
        uint256 deadline,
        bytes calldata userSignature,
        bytes calldata solverSignature
    ) external nonReentrant {
        // --- checks ---
        require(user != address(0), "zero user");
        require(token != address(0), "zero token");
        require(amount > 0, "zero amount");
        require(amount > fee, "fee >= amount");
	// slither-disable-next-line block-timestamp
        require(block.timestamp <= deadline, "expired");
        require(solverStakes[msg.sender] >= MINIMUM_STAKE, "Not staked");

        uint256 nonce = nonces[user];

        // Limit lifetime of locals (prevents stack-too-deep in default pipeline)
        {
            bytes32 intentDigest = _hashIntent(user, token, amount, fee, nonce, deadline);

            // Verify user signature for this exact intent
            require(ECDSA.recover(intentDigest, userSignature) == user, "Invalid user sig");

            // Verify solver commitment bound to this exact intent
            bytes32 solverDigest = _hashSolverCommit(intentDigest);
            require(ECDSA.recover(solverDigest, solverSignature) == msg.sender, "Invalid solver sig");
        } // temps out of scope here

        // --- effects ---
        nonces[user] = nonce + 1;

        // --- interactions ---
        // Slither flags "arbitrary-from" on this pattern, but it's safe because `user` is the EIP-712 signer.
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(token).safeTransferFrom(user, msg.sender, amount + fee);

        // If you prefer a split payout model, replace the line above with:
        // IERC20(token).safeTransferFrom(user, msg.sender, amount);
        // if (fee > 0) {
        //     IERC20(token).safeTransferFrom(user, msg.sender /* or feeRecipient */, fee);
        // }

        emit IntentFulfilled(user, msg.sender, token, amount, fee);
    }

    // ====== Optional: user-side cancel to bump nonce ======
    function cancelIntent(uint256 expectedNonce, bytes calldata sig) external {
        require(nonces[msg.sender] == expectedNonce, "nonce mismatch");
        bytes32 hash = _hashTypedDataV4(
            keccak256(abi.encode(_CANCEL_TYPEHASH, msg.sender, expectedNonce))
        );
        require(ECDSA.recover(hash, sig) == msg.sender, "bad cancel sig");
        nonces[msg.sender] = expectedNonce + 1;
    }
}
