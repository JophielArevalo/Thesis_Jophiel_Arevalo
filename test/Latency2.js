// scripts/CompareBridges.js
const { ethers } = require("hardhat");

async function main() {
  const [owner, user] = await ethers.getSigners();
  const solver = owner; // Using owner as solver for testing

  console.log("=== Deployment Phase ===");

  // Deploy TestToken
  const TestToken = await ethers.getContractFactory("TestToken");
  const token = await TestToken.deploy("TestToken", "TST");

  // Deploy TraditionalBridge
  const TraditionalBridge = await ethers.getContractFactory("TraditionalBridge");
  const traditionalBridge = await TraditionalBridge.deploy();

  // Deploy UltraEfficientIntentBridge
  const UltraEfficientIntentBridge = await ethers.getContractFactory("UltraEfficientIntentBridge");
  const intentBridge = await UltraEfficientIntentBridge.deploy();

  await Promise.all([
    token.waitForDeployment(),
    traditionalBridge.waitForDeployment(),
    intentBridge.waitForDeployment(),
  ]);

  console.log("Token deployed to:", await token.getAddress());
  console.log("TraditionalBridge deployed to:", await traditionalBridge.getAddress());
  console.log("IntentBridge deployed to:", await intentBridge.getAddress());

  // Test parameters
  const amount = ethers.parseUnits("100", 18);
  const fee = ethers.parseUnits("1", 16); // 0.01 TST (1% of 100 for 18 decimals)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // valid for 1 hour

  // Fund user
  await (await token.transfer(user.address, amount * 10n)).wait();

  // ================= Traditional Bridge Test =================
  console.log("\n=== Testing Traditional Bridge ===");
  const tradStart = Date.now();

  // Approval
  console.time("Traditional Approval");
  const tradApproveTx = await token.connect(user).approve(await traditionalBridge.getAddress(), amount);
  await tradApproveTx.wait();
  console.timeEnd("Traditional Approval");

  // Lock
  console.time("Traditional Lock");
  const tradLockTx = await traditionalBridge.connect(user).lockTokens(await token.getAddress(), amount);
  await tradLockTx.wait();
  console.timeEnd("Traditional Lock");

  // Simulate cross-chain delay (15s)
  await new Promise((resolve) => setTimeout(resolve, 15000));

  // Unlock
  console.time("Traditional Unlock");
  const tradUnlockTx = await traditionalBridge.connect(user).unlockTokens(await token.getAddress(), amount);
  await tradUnlockTx.wait();
  console.timeEnd("Traditional Unlock");

  const tradEnd = Date.now();

  // ================= Intent Bridge Test =================
  console.log("\n=== Testing Intent Bridge ===");
  const ibbStart = Date.now();

  // Solver stakes
  await (await intentBridge.connect(solver).stake({ value: ethers.parseEther("1") })).wait();

  // IMPORTANT: Approve amount + fee (contract transfers amount + fee to solver)
  console.time("IBB Approval");
  const ibbApproveTx = await token
    .connect(user)
    .approve(await intentBridge.getAddress(), amount + fee);
  await ibbApproveTx.wait();
  console.timeEnd("IBB Approval");

  // Prepare EIP-712 domain/types/values
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  const domain = {
    name: "UltraEfficientIntentBridge",
    version: "1",
    chainId,
    verifyingContract: await intentBridge.getAddress(),
  };

  // User nonce from contract (included in typed data)
  const userNonce = await intentBridge.nonces(user.address);

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
    amount,
    fee,
    nonce: userNonce,
    deadline,
  };

  // User signs the intent
  const userSignature = await user.signTypedData(domain, intentTypes, intentValue);

  // Compute the intent digest exactly as the contract does (EIP712 hash)
  const intentDigest = ethers.TypedDataEncoder.hash(domain, intentTypes, intentValue);

  // Solver signs commitment: SolverCommitment(bytes32 intentDigest)
  const solverTypes = {
    SolverCommitment: [{ name: "intentDigest", type: "bytes32" }],
  };
  const solverValue = { intentDigest };
  const solverSignature = await solver.signTypedData(domain, solverTypes, solverValue);

  // Optional: local verification (helps catch domain/type mismatches)
  const recoveredUser = ethers.verifyTypedData(domain, intentTypes, intentValue, userSignature);
  const recoveredSolver = ethers.verifyTypedData(domain, solverTypes, solverValue, solverSignature);
  console.log("Recovered user:", recoveredUser);
  console.log("Recovered solver:", recoveredSolver);

  // Simulate solver processing time (2s)
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Fulfill intent (MUST include deadline and signatures in the exact order)
  console.time("IBB Fulfillment");
  const fulfillTx = await intentBridge.connect(solver).fulfillIntent(
    user.address,
    await token.getAddress(),
    amount,
    fee,
    deadline,
    userSignature,
    solverSignature
  );
  const fulfillRcpt = await fulfillTx.wait();
  console.timeEnd("IBB Fulfillment");

  const ibbEnd = Date.now();

  // ================= Results & sanity checks =================
  const solverBal = await token.balanceOf(solver.address);
  const userBal = await token.balanceOf(user.address);

  console.log("\n=== Latency Comparison ===");
  console.log(`Traditional Bridge Total Time: ${(tradEnd - tradStart) / 1000} seconds`);
  console.log(`  - Includes 15s cross-chain delay simulation`);
  console.log(`Intent Bridge Total Time: ${(ibbEnd - ibbStart) / 1000} seconds`);
  console.log(`  - Includes 2s solver processing simulation`);

  console.log("\n=== Token Balances After IBB Fulfillment ===");
  console.log(`Solver: ${ethers.formatUnits(solverBal, 18)} TST`);
  console.log(`User:   ${ethers.formatUnits(userBal, 18)} TST`);


  console.log("\n=== Key Observations ===");
  console.log("- Intent Bridge eliminates cross-chain waiting time");
  console.log("- Traditional Bridge requires manual unlock on destination chain");
  console.log("- Intent Bridge uses EIP-712 signatures and solver staking for instant matching");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exitCode = 1;
});
