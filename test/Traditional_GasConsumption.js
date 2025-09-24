const { ethers } = require("hardhat");

async function main() {
  try {
    // Deploy contracts
    const TraditionalBridge = await ethers.getContractFactory("TraditionalBridge");
    const TestToken = await ethers.getContractFactory("TestToken");
    
    console.log("Deploying contracts...");
    const bridge = await TraditionalBridge.deploy();
    const token = await TestToken.deploy("TestToken", "TST");
    
    await Promise.all([
      bridge.waitForDeployment(),
      token.waitForDeployment()
    ]);

    console.log("Bridge deployed to:", await bridge.getAddress());
    console.log("Token deployed to:", await token.getAddress());

    // Setup users
    const [deployer, user] = await ethers.getSigners();
    const amount = ethers.parseUnits("100", 18);
    
    // 1. Transfer tokens to user from deployer
    console.log("\n1. Transferring tokens to user...");
    const transferTx = await token.transfer(user.address, amount * 10n);
    const transferReceipt = await transferTx.wait();
    console.log(`   - Gas used: ${transferReceipt.gasUsed.toString()}`);
    
    // 2. User approves tokens
    console.log("\n2. User approving tokens...");
    const approveTx = await token.connect(user).approve(await bridge.getAddress(), amount);
    const approveReceipt = await approveTx.wait();
    console.log(`   - Gas used: ${approveReceipt.gasUsed.toString()}`);

    // 3. User locks tokens (deposit)
    console.log("\n3. User locking tokens...");
    const lockTx = await bridge.connect(user).lockTokens(await token.getAddress(), amount);
    const lockReceipt = await lockTx.wait();

    console.log("\n=== Lock Transaction ===");
    console.log(`Status: ${lockReceipt.status === 1 ? "Success" : "Failed"}`);
    console.log(`Gas used: ${lockReceipt.gasUsed.toString()}`);
    console.log(`Effective gas price: ${ethers.formatUnits(lockReceipt.gasPrice, "gwei")} gwei`);
    console.log(`Transaction cost: ${ethers.formatUnits(lockReceipt.gasUsed * lockReceipt.gasPrice, "ether")} ETH`);
    
    // Check locked balance
    const lockedBalance = await bridge.lockedBalances(user.address, await token.getAddress());
    console.log(`Locked balance: ${ethers.formatUnits(lockedBalance, 18)} TST`);

    // 4. User unlocks tokens (withdraw)
    console.log("\n4. User unlocking tokens...");
    const unlockTx = await bridge.connect(user).unlockTokens(await token.getAddress(), amount);
    const unlockReceipt = await unlockTx.wait();

    console.log("\n=== Unlock Transaction ===");
    console.log(`Status: ${unlockReceipt.status === 1 ? "Success" : "Failed"}`);
    console.log(`Gas used: ${unlockReceipt.gasUsed.toString()}`);
    console.log(`Effective gas price: ${ethers.formatUnits(unlockReceipt.gasPrice, "gwei")} gwei`);
    console.log(`Transaction cost: ${ethers.formatUnits(unlockReceipt.gasUsed * unlockReceipt.gasPrice, "ether")} ETH`);
    
    // Calculate totals
    const totalGasUsed = lockReceipt.gasUsed + unlockReceipt.gasUsed;
    const totalCost = (lockReceipt.gasUsed * lockReceipt.gasPrice) + 
                     (unlockReceipt.gasUsed * unlockReceipt.gasPrice);

    console.log("\n=== Summary ===");
    console.log(`Total gas used for lock/unlock: ${totalGasUsed.toString()}`);
    console.log(`Total ETH cost: ${ethers.formatUnits(totalCost, "ether")}`);
    
    // Verify balances
    const bridgeBalance = await token.balanceOf(await bridge.getAddress());
    const userBalance = await token.balanceOf(user.address);
    console.log(`\nFinal balances:`);
    console.log(`- Bridge: ${ethers.formatUnits(bridgeBalance, 18)} TST`);
    console.log(`- User: ${ethers.formatUnits(userBalance, 18)} TST`);
    
  } catch (error) {
    console.error("\nError during execution:", error);
    process.exitCode = 1;
  }
}

main();