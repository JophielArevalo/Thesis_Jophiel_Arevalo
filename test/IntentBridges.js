const { ethers } = require("hardhat");

async function main() {
  try {
    // Deploy contracts
    const UltraEfficientIntentBridge = await ethers.getContractFactory("UltraEfficientIntentBridge");
    const TestToken = await ethers.getContractFactory("TestToken");
    
    console.log("Deploying contracts...");
    const bridge = await UltraEfficientIntentBridge.deploy();
    const token = await TestToken.deploy("TestToken", "TST");
    
    await Promise.all([
      bridge.waitForDeployment(),
      token.waitForDeployment()
    ]);

    console.log("Bridge deployed to:", await bridge.getAddress());
    console.log("Token deployed to:", await token.getAddress());

    // Setup users
    const [deployer, solver, user] = await ethers.getSigners();
    const amount = ethers.parseUnits("100", 18);
    const fee = ethers.parseUnits("1", 16); // 1% fee
    
    // 1. Transfer tokens to user from deployer
    console.log("Transferring tokens to user...");
    await (await token.transfer(user.address, amount * 10n)).wait();
    
    // 2. Solver stakes
    console.log("Solver staking...");
    await bridge.connect(solver).stake({ value: ethers.parseEther("1") });

    // 3. User prepares intent OFF-CHAIN
    console.log("Preparing off-chain intent...");
    const userNonce = await bridge.nonces(user.address);
    
    // EIP-712 typed data for user intent
    const intentDomain = {
      name: "UltraEfficientIntentBridge",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await bridge.getAddress()
    };
    
    const intentTypes = {
      Intent: [
        { name: "user", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };
    
    const intentValue = {
      user: user.address,
      token: await token.getAddress(),
      amount: amount,
      fee: fee,
      nonce: userNonce
    };
    
    // User signs the intent
    const userSignature = await user.signTypedData(intentDomain, intentTypes, intentValue);

    // 4. Solver prepares commitment OFF-CHAIN
    console.log("Solver preparing commitment...");
    const solverDomain = {
      name: "UltraEfficientIntentBridge",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await bridge.getAddress()
    };
    
    const solverTypes = {
      SolverCommitment: [
        { name: "user", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" }
      ]
    };
    
    const solverValue = {
      user: user.address,
      token: await token.getAddress(),
      amount: amount,
      fee: fee
    };
    
    // Solver signs the commitment
    const solverSignature = await solver.signTypedData(solverDomain, solverTypes, solverValue);

    // 5. User approves tokens
    console.log("User approving tokens...");
    await (await token.connect(user).approve(await bridge.getAddress(), amount)).wait();

    // 6. Execute on-chain fulfillment
    console.log("Executing fulfillment...");
    const tx = await bridge.connect(solver).fulfillIntent(
      user.address,
      await token.getAddress(),
      amount,
      fee,
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
    
  } catch (error) {
    console.error("\nError during execution:", error);
    process.exitCode = 1;
  }
}

main();