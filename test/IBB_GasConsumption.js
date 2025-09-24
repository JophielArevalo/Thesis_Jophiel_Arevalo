// scripts/IntentBridge.js
const { ethers } = require("hardhat");

async function main() {
  try {
    // Deploy contracts
    const UltraEfficientIntentBridge = await ethers.getContractFactory("UltraEfficientIntentBridge");
    const TestToken = await ethers.getContractFactory("TestToken");

    console.log("Deploying contracts...");
    const bridge = await UltraEfficientIntentBridge.deploy();
    const token = await TestToken.deploy("TestToken", "TST");

    await Promise.all([bridge.waitForDeployment(), token.waitForDeployment()]);

    console.log("Bridge deployed to:", await bridge.getAddress());
    console.log("Token deployed to:", await token.getAddress());

    // Setup users
    const [deployer, solver, user] = await ethers.getSigners();
    const amount = ethers.parseUnits("100", 18);
    const fee = ethers.parseUnits("1", 16); // 0.01 TST (1% of 100 for 18 decimals)
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60; // valid for 1 hour

    // 1) Fund user with tokens
    console.log("Transferring tokens to user...");
    await (await token.transfer(user.address, amount * 10n)).wait(); // plenty to cover amount + fee

    // 2) Solver stakes
    console.log("Solver staking...");
    await (await bridge.connect(solver).stake({ value: ethers.parseEther("1") })).wait();

    // 3) Prepare EIP-712 domain and typed data (OFF-CHAIN)
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    const domain = {
      name: "UltraEfficientIntentBridge",
      version: "1",
      chainId,
      verifyingContract: await bridge.getAddress(),
    };

    // Get current user nonce from contract (used in the intent)
    const userNonce = await bridge.nonces(user.address);

    // ----- User Intent -----
    const intentTypes = {
      Intent: [
        { name: "user", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const intentValue = {
      user: user.address,
      token: await token.getAddress(),
      amount: amount,
      fee: fee,
      nonce: userNonce,
      deadline: BigInt(deadline),
    };

    console.log("Preparing off-chain intent...");
    const userSignature = await user.signTypedData(domain, intentTypes, intentValue);

    // Compute the intent digest exactly how the contract does:
    // _hashTypedDataV4( keccak256(abi.encode(_INTENT_TYPEHASH, ...)) )
    const intentDigest = ethers.TypedDataEncoder.hash(domain, intentTypes, intentValue);

    // ----- Solver Commitment (signs the digest) -----
    const solverTypes = {
      SolverCommitment: [{ name: "intentDigest", type: "bytes32" }],
    };
    const solverValue = { intentDigest };

    console.log("Solver preparing commitment...");
    const solverSignature = await solver.signTypedData(domain, solverTypes, solverValue);

    // 4) User approves tokens (must cover amount + fee because contract pulls both)
    console.log("User approving tokens...");
    await (await token.connect(user).approve(await bridge.getAddress(), amount + fee)).wait();

    // 5) Execute fulfillment ON-CHAIN (include deadline, in correct order)
    console.log("Executing fulfillment...");
    const tx = await bridge.connect(solver).fulfillIntent(
      user.address,
      await token.getAddress(),
      amount,
      fee,
      BigInt(deadline),     // <-- required by contract
      userSignature,
      solverSignature
    );
    const receipt = await tx.wait();

    console.log("\n=== Transaction Results ===");
    console.log(`Status: ${receipt.status === 1 ? "Success" : "Failed"}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    // Verify balances
    const solverBalance = await token.balanceOf(solver.address);
    const userBalance = await token.balanceOf(user.address);
    console.log(`\nFinal balances:`);
    console.log(`- Solver: ${ethers.formatUnits(solverBalance, 18)} TST`);
    console.log(`- User: ${ethers.formatUnits(userBalance, 18)} TST`);

    // Optional: quick local verifier (off-chain)
    const recoveredUser = ethers.verifyTypedData(domain, intentTypes, intentValue, userSignature);
    const recoveredSolver = ethers.verifyTypedData(domain, solverTypes, solverValue, solverSignature);
    console.log(`\nRecovered user:  ${recoveredUser}`);
    console.log(`Recovered solver: ${recoveredSolver}`);
    console.log(`Expected solver:  ${solver.address}`);

  } catch (error) {
    console.error("\nError during execution:", error);
    process.exitCode = 1;
  }
}

main();
