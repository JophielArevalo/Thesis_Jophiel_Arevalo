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
  
  // Deploy UltraEfficientIntentBridge (matches your contract name)
  const UltraEfficientIntentBridge = await ethers.getContractFactory("UltraEfficientIntentBridge");
  const intentBridge = await UltraEfficientIntentBridge.deploy();
  
  await Promise.all([
    token.waitForDeployment(),
    traditionalBridge.waitForDeployment(),
    intentBridge.waitForDeployment()
  ]);

  console.log("Token deployed to:", await token.getAddress());
  console.log("TraditionalBridge deployed to:", await traditionalBridge.getAddress());
  console.log("IntentBridge deployed to:", await intentBridge.getAddress());

  // Test parameters
  const amount = ethers.parseUnits("100", 18);
  const fee = ethers.parseUnits("1", 16); // 1% fee
  await (await token.transfer(user.address, amount * 10n)).wait();

  // ========== Traditional Bridge Test ==========
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
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  // Unlock
  console.time("Traditional Unlock");
  const tradUnlockTx = await traditionalBridge.connect(user).unlockTokens(await token.getAddress(), amount);
  await tradUnlockTx.wait();
  console.timeEnd("Traditional Unlock");
  
  const tradEnd = Date.now();

  // ========== Intent Bridge Test ==========
  console.log("\n=== Testing Intent Bridge ===");
  const ibbStart = Date.now();
  
  // Setup solver
  await (await intentBridge.connect(solver).stake({ value: ethers.parseEther("1") })).wait();
  
  // Approval
  console.time("IBB Approval");
  const ibbApproveTx = await token.connect(user).approve(await intentBridge.getAddress(), amount);
  await ibbApproveTx.wait();
  console.timeEnd("IBB Approval");

  // Prepare EIP-712 intent
  const userNonce = await intentBridge.nonces(user.address);
  const intent = {
    user: user.address,
    token: await token.getAddress(),
    amount: amount,
    fee: fee,
    nonce: userNonce
  };
  
  // User signs intent
  const userSignature = await user.signTypedData(
    {
      name: "UltraEfficientIntentBridge",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await intentBridge.getAddress()
    },
    {
      Intent: [
        { name: "user", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    },
    intent
  );

  // Solver signs commitment
  const solverSignature = await solver.signTypedData(
    {
      name: "UltraEfficientIntentBridge",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await intentBridge.getAddress()
    },
    {
      SolverCommitment: [
        { name: "user", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" }
      ]
    },
    {
      user: user.address,
      token: await token.getAddress(),
      amount: amount,
      fee: fee
    }
  );

  // Simulate solver processing time (2s)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Fulfill intent
  console.time("IBB Fulfillment");
  const fulfillTx = await intentBridge.connect(solver).fulfillIntent(
    user.address,
    await token.getAddress(),
    amount,
    fee,
    userSignature,
    solverSignature
  );
  await fulfillTx.wait();
  console.timeEnd("IBB Fulfillment");
  
  const ibbEnd = Date.now();

  // ========== Results ==========
  console.log("\n=== Latency Comparison ===");
  console.log(`Traditional Bridge Total Time: ${(tradEnd - tradStart)/1000} seconds`);
  console.log(`  - Includes 15s cross-chain delay simulation`);
  console.log(`Intent Bridge Total Time: ${(ibbEnd - ibbStart)/1000} seconds`);
  console.log(`  - Includes 2s solver processing simulation`);
  
  console.log("\n=== Key Observations ===");
  console.log("- Intent Bridge eliminates cross-chain waiting time");
  console.log("- Traditional Bridge requires manual unlock on destination chain");
  console.log("- Intent Bridge uses EIP-712 signatures for instant matching");
}

main().catch(error => {
  console.error("Error:", error);
  process.exitCode = 1;
});