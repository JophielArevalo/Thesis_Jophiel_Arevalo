const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Bridge Comparison", function () {
  let owner, user, solver;
  let traditionalBridge, intentBridge;
  let tokenA, tokenB;

  before(async function () {
    [owner, user, solver] = await ethers.getSigners();

    // Deploy test tokens with error handling
    try {
      const TestToken = await ethers.getContractFactory("TestToken");
      tokenA = await TestToken.deploy("TokenA", "TKA");
      tokenB = await TestToken.deploy("TokenB", "TKB");
      
      console.log("TokenA deployed to:", tokenA.target);
      console.log("TokenB deployed to:", tokenB.target);

      // Deploy bridges
      const TraditionalBridge = await ethers.getContractFactory("TraditionalBridge");
      traditionalBridge = await TraditionalBridge.deploy();
      console.log("TraditionalBridge deployed to:", traditionalBridge.target);

      const IntentBridge = await ethers.getContractFactory("IntentBridge");
      intentBridge = await IntentBridge.deploy();
      console.log("IntentBridge deployed to:", intentBridge.target);

      // Verify all contracts are deployed
      if (!tokenA.target || !tokenB.target || !traditionalBridge.target || !intentBridge.target) {
        throw new Error("One or more contracts failed to deploy");
      }

      // Transfer tokens
      const amount = ethers.parseUnits("1000", 18);
      await (await tokenA.transfer(user.address, amount)).wait();
      await (await tokenB.transfer(solver.address, amount)).wait();
    } catch (error) {
      console.error("Deployment error:", error);
      throw error;
    }
  });

  describe("Traditional Bridge", function () {
    it("Should lock and unlock tokens", async function () {
      const amount = ethers.parseUnits("100", 18);
      
      // Approve
      await (await tokenA.connect(user).approve(traditionalBridge.target, amount)).wait();
      
      // Lock tokens
      await (await traditionalBridge.connect(user).lockTokens(tokenA.target, amount)).wait();
      
      // Verify locked balance
      const locked = await traditionalBridge.lockedBalances(user.address, tokenA.target);
      expect(locked).to.equal(amount);
      
      // Unlock tokens
      await (await traditionalBridge.connect(user).unlockTokens(tokenA.target, amount)).wait();
      
      // Verify final balance
      const finalBalance = await tokenA.balanceOf(user.address);
      expect(finalBalance).to.equal(ethers.parseUnits("1000", 18));
    });
  });

  describe("Intent Bridge", function () {
    it("Should handle full intent lifecycle", async function () {
      const amount = ethers.parseUnits("100", 18);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // Solver stakes ETH
      await (await intentBridge.connect(solver).stake({ value: ethers.parseEther("1") })).wait();
      
      // User approves and declares intent
      await (await tokenA.connect(user).approve(intentBridge.target, amount)).wait();
      const tx = await intentBridge.connect(user).declareIntent(
        tokenA.target,
        tokenB.target,
        amount,
        amount,
        deadline
      );
      const receipt = await tx.wait();
      
      // Get intent ID
      const event = receipt.logs.find(log => {
        try {
          return intentBridge.interface.parseLog(log)?.name === "IntentDeclared";
        } catch {
          return false;
        }
      });
      
      const intentId = event.args.intentId;
      
      // Solver fulfills intent
      await (await intentBridge.connect(solver).fulfillIntent(intentId, 0)).wait();
      
      // Verify fulfillment
      const intent = await intentBridge.intents(intentId);
      expect(intent.status).to.equal(1); // 1 = Fulfilled
    });
  });
});