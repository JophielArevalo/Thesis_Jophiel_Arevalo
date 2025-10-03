/* eslint-disable no-console */
// Experiment 2 — Graph-based validation of event/operation sequences on UEIBB
// Focus: detect illegal transitions (e.g., UNSTAKED→FULFILLED, EXPIRED→FULFILLED, BAD_SIG→FULFILLED)
// and summarise observed edges as an adjacency report.
//
// RUN:
//   npx hardhat run scripts/Exp2_StateGraph_UEIBB.js
//
// OUTPUT: console adjacency list + illegal attempts summary; optional CSV/JSON (toggle SAVE_FILES)

const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

// -------------- CONFIG --------------
const CFG = {
  SAVE_FILES: true,
  GOOD_TRIALS: 20,     // number of valid fulfillments
  BAD_TRIALS: 6,       // number of negative tests (unstaked/expired/badsig)
  DEADLINE_SECS: 300,  // 5-minute deadline for good trials
};

// -------------- UTILS --------------
async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }); }
function edgeKey(a,b){ return `${a} -> ${b}`; }

function typedIntent() {
  return {
    Intent: [
      { name: "user",     type: "address"  },
      { name: "token",    type: "address"  },
      { name: "amount",   type: "uint256"  },
      { name: "fee",      type: "uint256"  },
      { name: "nonce",    type: "uint256"  },
      { name: "deadline", type: "uint256"  }
    ]
  };
}
function typedSolver() {
  return { SolverCommitment: [ { name:"intentDigest", type:"bytes32" } ] };
}

async function main() {
  const [deployer, user, s1, s2, s3, s4, s5, s6] = await ethers.getSigners();
  const stakedSolvers   = [s1, s2, s3];
  const unstakedSolvers = [s4, s5];         // for illegal UNSTAKED→FULFILLED attempts
  const maybeBadSig     = s6;               // to generate BAD_SIG

  const Token  = await ethers.getContractFactory("MockToken");
  const Bridge = await ethers.getContractFactory("UltraEfficientIntentBridge");

  const token  = await Token.deploy();
  await token.waitForDeployment();
  const bridge = await Bridge.deploy();
  await bridge.waitForDeployment();

  // Fund user and approve bridge
  await (await token.mint(user.address, ethers.parseUnits("1000000", 18))).wait();
  await (await token.connect(user).approve(await bridge.getAddress(), ethers.MaxUint256)).wait();

  // Stake the stakedSolvers with >= 1 ETH
  for (const s of stakedSolvers) {
    await (await bridge.connect(s).stake({ value: ethers.parseEther("1") })).wait();
  }

  const outDir  = path.join(__dirname, "..", "results");
  const jsonOut = path.join(outDir, "exp2_graph_results.json");
  const csvOut  = path.join(outDir, "exp2_graph_edges.csv");
  if (CFG.SAVE_FILES) await ensureDir(outDir);

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain  = {
    name: "UltraEfficientIntentBridge",
    version: "1",
    chainId,
    verifyingContract: await bridge.getAddress()
  };

  const tokenAddr = await token.getAddress();
  const amountWei = ethers.parseUnits("5", 18);
  const feeWei    = ethers.parseUnits("0.005", 18);

  // Graph data
  const edges = new Map();                 // "A -> B" -> count
  const illegal = [];                      // records of illegal attempts
  function addEdge(a,b){ const k=edgeKey(a,b); edges.set(k,(edges.get(k)||0)+1); }

  // Helper: build valid EIP-712 pair
  async function buildSigs({ u, solver, amount, fee, deadline }) {
    const nonce = await bridge.nonces(u.address);
    const intentVal = { user: u.address, token: tokenAddr, amount, fee, nonce, deadline };
    const userSig   = await u.signTypedData(domain, typedIntent(), intentVal);
    const digest    = ethers.TypedDataEncoder.hash(domain, typedIntent(), intentVal);
    const solverSig = await solver.signTypedData(domain, typedSolver(), { intentDigest: digest });
    return { userSig, solverSig, intentVal };
  }

  // ---------- 1) GOOD PATHS ----------
  // Expected: UNSTAKED→STAKED (already done), then STAKED→FULFILLED for many trials
  for (let i = 0; i < CFG.GOOD_TRIALS; i++) {
    const solver = stakedSolvers[i % stakedSolvers.length];
    const deadline = BigInt(Math.floor(Date.now()/1000) + CFG.DEADLINE_SECS);
    const { userSig, solverSig } = await buildSigs({ u:user, solver, amount:amountWei, fee:feeWei, deadline });

    // Edge: STAKED -> FULFILLED
    try {
      const tx = await bridge.connect(solver).fulfillIntent(user.address, tokenAddr, amountWei, feeWei, deadline, userSig, solverSig);
      await tx.wait();
      addEdge("STAKED", "FULFILLED");
    } catch (e) {
      illegal.push({ kind:"UNEXPECTED_REVERT_GOOD", solver: solver.address, reason: e.shortMessage ?? e.message });
    }
  }

  // ---------- 2) ILLEGAL: UNSTAKED -> FULFILLED ----------
  // A solver without stake should fail fulfillIntent
  for (const solver of unstakedSolvers) {
    const deadline = BigInt(Math.floor(Date.now()/1000) + CFG.DEADLINE_SECS);
    const { userSig, solverSig } = await buildSigs({ u:user, solver, amount:amountWei, fee:feeWei, deadline });
    try {
      await bridge.connect(solver).fulfillIntent(user.address, tokenAddr, amountWei, feeWei, deadline, userSig, solverSig);
      // If it succeeds, it's truly illegal
      addEdge("UNSTAKED", "FULFILLED");
      illegal.push({ kind:"UNSTAKED_FULFILLED_SUCCEEDED", solver: solver.address, reason:"should have reverted" });
    } catch (e) {
      // Expected revert
      illegal.push({ kind:"UNSTAKED_FULFILLED_ATTEMPT", solver: solver.address, reason: e.shortMessage ?? e.message });
    }
  }

  // ---------- 3) ILLEGAL: EXPIRED -> FULFILLED ----------
  {
    const solver = stakedSolvers[0];
    const expired = BigInt(Math.floor(Date.now()/1000) - 5); // 5s in the past
    const { userSig, solverSig } = await buildSigs({ u:user, solver, amount:amountWei, fee:feeWei, deadline: expired });
    try {
      await bridge.connect(solver).fulfillIntent(user.address, tokenAddr, amountWei, feeWei, expired, userSig, solverSig);
      addEdge("EXPIRED", "FULFILLED");
      illegal.push({ kind:"EXPIRED_SUCCEEDED", solver: solver.address, reason:"deadline check failed to revert" });
    } catch (e) {
      illegal.push({ kind:"EXPIRED_ATTEMPT", solver: solver.address, reason: e.shortMessage ?? e.message });
    }
  }

  // ---------- 4) ILLEGAL: BAD_SIG -> FULFILLED ----------
  {
    const solver = stakedSolvers[1];
    const deadline = BigInt(Math.floor(Date.now()/1000) + CFG.DEADLINE_SECS);
    // Create a correct userSig but a WRONG solverSig by signing from a different key (maybeBadSig)
    const nonce = await bridge.nonces(user.address);
    const intentVal = { user: user.address, token: tokenAddr, amount: amountWei, fee: feeWei, nonce, deadline };
    const userSig   = await user.signTypedData(domain, typedIntent(), intentVal);
    const digest    = ethers.TypedDataEncoder.hash(domain, typedIntent(), intentVal);
    const wrongSig  = await maybeBadSig.signTypedData(domain, typedSolver(), { intentDigest: digest });

    try {
      await bridge.connect(solver).fulfillIntent(user.address, tokenAddr, amountWei, feeWei, deadline, userSig, wrongSig);
      addEdge("BAD_SIG", "FULFILLED");
      illegal.push({ kind:"BAD_SIG_SUCCEEDED", solver: solver.address, reason:"solverSig validation failed to revert" });
    } catch (e) {
      illegal.push({ kind:"BAD_SIG_ATTEMPT", solver: solver.address, reason: e.shortMessage ?? e.message });
    }
  }

  // ---------- Optional: WITHDRAW after fulfill ----------
  for (const s of stakedSolvers) {
    try {
      const tx = await bridge.connect(s).withdrawStake(ethers.parseEther("0.1"));
      await tx.wait();
      addEdge("STAKED", "WITHDRAWN");
    } catch (e) {
      // ignore if insufficient balance due to previous withdraws
    }
  }

  // ---------- REPORT ----------
  // Adjacency list
  console.log("\n=== Experiment 2 — Observed Edges (Adjacency) ===");
  if (edges.size === 0) {
    console.log("(no edges recorded)");
  } else {
    for (const [k,v] of edges.entries()) console.log(`${k.padEnd(28)} : ${v}`);
  }

  // Illegal attempts summary
  console.log("\n=== Illegal Transition Attempts (expected reverts) ===");
  if (!illegal.length) {
    console.log("None.");
  } else {
    for (const r of illegal) {
      console.log(`- ${r.kind} :: solver=${r.solver} :: reason=${r.reason}`);
    }
  }

  // Persist
  if (CFG.SAVE_FILES) {
    const edgesRows = Array.from(edges.entries()).map(([k,v]) => ({ edge:k, count:v }));
    await ensureDir(outDir);
    await fs.promises.writeFile(jsonOut, JSON.stringify({ edges: edgesRows, illegal }, null, 2));
    const csvHeader = "edge,count\n";
    const csvBody   = edgesRows.map(e => `${e.edge},${e.count}`).join("\n");
    await fs.promises.writeFile(csvOut, csvHeader + csvBody);
    console.log(`\nSaved -> ${jsonOut}`);
    console.log(`Saved -> ${csvOut}`);
  }

  // Quick verdict line for your thesis: zero truly illegal successes?
  const illegalSuccess = illegal.find(x => /_SUCCEEDED$/.test(x.kind));
  if (illegalSuccess) {
    console.log("\nVERDICT: ❌ An unexpected illegal transition SUCCEEDED. See above.");
  } else {
    console.log("\nVERDICT: ✅ All illegal transitions correctly REVERTED; only valid edges observed.");
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
