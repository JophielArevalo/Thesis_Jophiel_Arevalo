// scripts/CompareBridges.randomized.js
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

/**
 * CLI args:
 *   --runs <int>            default 5
 *   --ackDelayMs <int>      default 2000   (randomized dispatch "ack" delay)
 *   --tradDelayMs <int>     default 15000 (traditional cross-chain confirmation delay)
 *
 * Example:
 *   npx hardhat run scripts/CompareBridges.randomized.js --network hardhat --runs 10 --ackDelayMs 250 --tradDelayMs 15000
 */

function getArg(flag, def) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return def;
}

const RUNS = getArg("--runs", 5);
const ACK_DELAY_MS = getArg("--ackDelayMs", 2000);
const TRAD_DELAY_MS = getArg("--tradDelayMs", 15000);

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
}


async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Params:", { RUNS, ACK_DELAY_MS, TRAD_DELAY_MS });

  const signers = await ethers.getSigners();
  if (signers.length < 6) {
    throw new Error("Need at least 6 signers (owner,user, and ≥4 solvers).");
  }
  const [owner, user, s2, s3, s4, s5] = signers;
  const solverPool = [owner, s2, s3, s4, s5]; // randomized selection from this pool

  console.log("=== Deployment Phase ===");
  const TestToken = await ethers.getContractFactory("TestToken");
  const token = await TestToken.deploy("TestToken", "TST");

  const TraditionalBridge = await ethers.getContractFactory("TraditionalBridge");
  const traditionalBridge = await TraditionalBridge.deploy();

  const UltraEfficientIntentBridge = await ethers.getContractFactory("UltraEfficientIntentBridge");
  const intentBridge = await UltraEfficientIntentBridge.deploy();

  await Promise.all([
    token.waitForDeployment(),
    traditionalBridge.waitForDeployment(),
    intentBridge.waitForDeployment(),
  ]);

  const tokenAddr = await token.getAddress();
  const tradAddr = await traditionalBridge.getAddress();
  const ibbAddr = await intentBridge.getAddress();

  console.log("Token           :", tokenAddr);
  console.log("TraditionalBridge:", tradAddr);
  console.log("IntentBridge     :", ibbAddr);

  // Test parameters
  const amount = ethers.parseUnits("100", 18);
  const fee = ethers.parseUnits("1", 16); // 0.01 TST
  // Fund user enough for all runs (amount + fee per run)
  const totalNeeded = (amount + fee) * BigInt(RUNS + 2);
  await (await token.transfer(user.address, totalNeeded)).wait();

  // Stake each solver once (bond requirement)
  console.log("\n=== Staking solvers ===");
  for (const s of solverPool) {
    const balBefore = await ethers.provider.getBalance(s.address);
    await (await intentBridge.connect(s).stake({ value: ethers.parseEther("1") })).wait();
    const balAfter = await ethers.provider.getBalance(s.address);
    console.log(`Staked: ${s.address}  ΔETH: -${ethers.formatEther(balBefore - balAfter)}`);
  }

  // Arrays for metrics over runs
  const tradApprovalMs = [];
  const tradLockMs = [];
  const tradUnlockMs = [];
  const tradE2Ems = [];
  const tradGas = [];

  const ibbSelectMs = [];
  const ibbApprovalMs = [];
  const ibbFulfillMs = [];
  const ibbE2Ems = [];
  const ibbGas = [];


  for (let i = 0; i < RUNS; i++) {
    console.log(`\n========== RUN ${i + 1}/${RUNS} ==========`);

    // ---------- Traditional Bridge ----------
    console.log("\n=== Traditional Bridge ===");
    const tStart = Date.now();

    const t0 = Date.now();
    const tradApproveTx = await token.connect(user).approve(tradAddr, amount);
    const tradApproveRcpt = await tradApproveTx.wait();
    const tApproval = Date.now() - t0;

    const t1 = Date.now();
    const tradLockTx = await traditionalBridge.connect(user).lockTokens(tokenAddr, amount);
    const tradLockRcpt = await tradLockTx.wait();
    const tLock = Date.now() - t1;

    // Simulate cross-chain confirmation delay
    await sleep(TRAD_DELAY_MS);

    const t2 = Date.now();
    const tradUnlockTx = await traditionalBridge.connect(user).unlockTokens(tokenAddr, amount);
    const tradUnlockRcpt = await tradUnlockTx.wait();
    const tUnlock = Date.now() - t2;

    const tEnd = Date.now();
    const tE2E = tApproval + tLock + tUnlock + TRAD_DELAY_MS;

    const tradGasUsed =
      Number(tradApproveRcpt.gasUsed) +
      Number(tradLockRcpt.gasUsed) +
      Number(tradUnlockRcpt.gasUsed);

    tradApprovalMs.push(tApproval);
    tradLockMs.push(tLock);
    tradUnlockMs.push(tUnlock);
    tradE2Ems.push(tE2E);
    tradGas.push(tradGasUsed);


    // ---------- IBB (Randomized Dispatch) ----------
    console.log("\n=== Intent Bridge (Randomized Dispatch) ===");

    const ibbStart = Date.now();

    // Pick a solver uniformly at random
    const s0 = Date.now();
    const solver = solverPool[Math.floor(Math.random() * solverPool.length)];
    const tSelect = Date.now() - s0;

    // Simulate randomized dispatch "ack" / selection latency
    
    await sleep(ACK_DELAY_MS);
    

    // Approve amount + fee (dual-lock model pre-funding solver payment)
    const a0 = Date.now();
    const ibbApproveTx = await token.connect(user).approve(ibbAddr, amount + fee);
    const ibbApproveRcpt = await ibbApproveTx.wait();
    const tIbbApproval = Date.now() - a0;

    // Prepare typed data and signatures
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    const domain = {
      name: "UltraEfficientIntentBridge",
      version: "1",
      chainId,
      verifyingContract: ibbAddr,
    };

    const userNonce = await intentBridge.nonces(user.address);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);

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
      token: tokenAddr,
      amount,
      fee,
      nonce: userNonce,
      deadline,
    };

    const userSignature = await user.signTypedData(domain, intentTypes, intentValue);

    const intentDigest = ethers.TypedDataEncoder.hash(domain, intentTypes, intentValue);
    const solverTypes = { SolverCommitment: [{ name: "intentDigest", type: "bytes32" }] };
    const solverValue = { intentDigest };
    const solverSignature = await solver.signTypedData(domain, solverTypes, solverValue);

    // Fulfillment
    const f0 = Date.now();
    const fulfillTx = await intentBridge.connect(solver).fulfillIntent(
      user.address,
      tokenAddr,
      amount,
      fee,
      deadline,
      userSignature,
      solverSignature
    );
    const fulfillRcpt = await fulfillTx.wait();
    const tFulfill = Date.now() - f0;

    const ibbEnd = Date.now();
    const tIbbE2E = tSelect + tIbbApproval + tFulfill + ACK_DELAY_MS;
    const ibbGasUsed = Number(ibbApproveRcpt.gasUsed) + Number(fulfillRcpt.gasUsed);

    ibbSelectMs.push(tSelect);
    ibbApprovalMs.push(tIbbApproval);
    ibbFulfillMs.push(tFulfill);
    ibbE2Ems.push(tIbbE2E);
    ibbGas.push(ibbGasUsed);

  }

  // ---- Aggregate stats ----
  const stats = {
    trad: {
      approvalMs: { mean: mean(tradApprovalMs)},
      lockMs: { mean: mean(tradLockMs)},
      unlockMs: { mean: mean(tradUnlockMs)},
      e2eMs: { mean: mean(tradE2Ems)},
      gas: { mean: mean(tradGas)},
    },
    ibb: {
      selectMs: { mean: mean(ibbSelectMs)},
      approvalMs: { mean: mean(ibbApprovalMs)},
      fulfillMs: { mean: mean(ibbFulfillMs)},
      e2eMs: { mean: mean(ibbE2Ems)},
      gas: { mean: mean(ibbGas)},
    },
  };

  const RT = stats.trad.e2eMs.mean / stats.ibb.e2eMs.mean;
  const RG = (stats.trad.gas.mean - stats.ibb.gas.mean) / stats.trad.gas.mean;

  console.log("\n=== Aggregated Results ===");
  console.table({
    "Trad E2E (ms)": stats.trad.e2eMs.mean.toFixed(2),
    "Trad Approv (ms)": stats.trad.approvalMs.mean.toFixed(2),
    "Trad lock (ms)": stats.trad.lockMs.mean.toFixed(2),
    "Trad Unlock(ms)": stats.trad.unlockMs.mean.toFixed(2),
    "IBB E2E (ms)": stats.ibb.e2eMs.mean.toFixed(2),
    "IBB Select (ms)": stats.ibb.selectMs.mean.toFixed(2),
    "IBB Approv (ms)": stats.ibb.approvalMs.mean.toFixed(2),
    "IBB Fullfil (ms)": stats.ibb.fulfillMs.mean.toFixed(2),
    "R_T = Trad/IBB": RT.toFixed(2),
    "Trad Gas (avg)": stats.trad.gas.mean.toFixed(0),
    "IBB Gas (avg)": stats.ibb.gas.mean.toFixed(0),
    "R_G (gas save)": (RG * 100).toFixed(2) + "%",
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exitCode = 1;
});
