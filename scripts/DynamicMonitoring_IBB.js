/* eslint-disable no-console */
//
// Experiment 1 — Dynamic Monitoring & Anomaly Detection (UltraEfficientIntentBridge)
// Uses your single-call flow: fulfillIntent(user, token, amount, fee, deadline, userSig, solverSig)
// ACK latency here is the solver's off-chain time-to-act before calling fulfillIntent.
//
// RUN:
//   npx hardhat run scripts/Exp1_DynamicMonitoring_UEIBB.js
//
// Outputs:
//   - Console summary + ASCII histogram
//   - ./results/exp1_results.json and .csv (toggle via CFG.SAVE_FILES)
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

// ---------------- CONFIG ----------------
const CFG = {
  TRIALS: 100,                 // number of intents
  DELTA_ACK_MS: 2000,          // SLA threshold for ACK anomaly flag
  INJECT_ACK_ANOM_RATE: 0.10,  // 10% anomaly trials
  INJECT_ACK_EXTRA_MS: 5000,   // +5 s injected delay
  BASE_ACK_JITTER_MS: [120, 650],    // baseline jitter window
  AMOUNT: "10.0",              // 10 tokens (assume 18 decimals)
  FEE: "0.01",
  DEADLINE_SECS: 3600,         // intent validity horizon (now + 1h)
  SAVE_FILES: true,
  FRESH_DEPLOY: true           // set false to attach to existing addresses
};

// If attaching to existing deployments (FRESH_DEPLOY=false), set:
const ADDR = {
  TOKEN: "0xYourMockTokenAddress",
  BRIDGE: "0xYourUltraEfficientIntentBridgeAddress"
};

// -------------- UTILS -------------------
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function mean(xs) { return xs.reduce((a,b)=>a+b,0) / (xs.length || 1); }
function std(xs) { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); }
function pct(xs, p) {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x,y)=>x-y);
  const i = Math.min(a.length - 1, Math.max(0, Math.round((p/100) * (a.length - 1))));
  return a[i];
}
function asciiHistogram(data, bins=20, width=40, label="") {
  if (!data.length) return "(no data)";
  const min = Math.min(...data), max = Math.max(...data);
  const step = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const x of data) {
    const idx = Math.min(bins-1, Math.max(0, Math.floor((x - min) / step)));
    counts[idx]++;
  }
  const peak = Math.max(...counts) || 1;
  let out = `\n[ASCII Histogram] ${label} (bins=${bins})\n`;
  out += `min=${min.toFixed(1)}  max=${max.toFixed(1)}  step=${step.toFixed(1)}\n`;
  for (let i = 0; i < bins; i++) {
    const bar = "█".repeat(Math.round((counts[i] / peak) * width));
    const from = (min + i*step).toFixed(1);
    const to   = (min + (i+1)*step).toFixed(1);
    out += `${from.padStart(8)}–${to.padEnd(8)} | ${bar} ${counts[i]}\n`;
  }
  return out;
}
async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }); }
function rowToCsv(o) {
  return [
    o.trial,
    o.solver,
    o.ack_time_ms,
    o.ack_anomaly ? 1 : 0,
    o.gas_fulfill
  ].join(",");
}

// -------------- EIP-712 helpers (match your contract) --------------
function intentTypes() {
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
function solverTypes() {
  return {
    SolverCommitment: [
      { name: "intentDigest", type: "bytes32" }
    ]
  };
}

// ---------------- MAIN -------------------
async function main() {
  const [deployer, user, ...rest] = await ethers.getSigners();
  const solvers = rest.slice(0, 5); // use first 5 as solver pool

  // Output paths
  const outDir  = path.join(__dirname, "..", "results");
  const jsonOut = path.join(outDir, "exp1_results.json");
  const csvOut  = path.join(outDir, "exp1_results.csv");
  if (CFG.SAVE_FILES) await ensureDir(outDir);

  // Factories
  const Token  = await ethers.getContractFactory("MockToken");
  const Bridge = await ethers.getContractFactory("UltraEfficientIntentBridge");

  // Deploy / attach
  let token, bridge;
  if (CFG.FRESH_DEPLOY) {
    token = await Token.deploy();
    await token.waitForDeployment();

    // Mint a large balance to user
    await (await token.mint(user.address, ethers.parseUnits("1000000", 18))).wait();

    // Your UEIBB has EIP712 only; constructor takes no args in your code
    bridge = await Bridge.deploy();
    await bridge.waitForDeployment();
  } else {
    token  = await Token.attach(ADDR.TOKEN);
    bridge = await Bridge.attach(ADDR.BRIDGE);
  }

  console.log("== UEIBB – Experiment 1 ==");
  console.log("Deployer:", deployer.address);
  console.log("User    :", user.address);
  console.log("Solvers :", solvers.map(s=>s.address).join(", "));
  console.log("Token   :", await token.getAddress());
  console.log("Bridge  :", await bridge.getAddress());
  console.log();

  // One-time: user approves the bridge to pull funds on their behalf
  await (await token.connect(user).approve(await bridge.getAddress(), ethers.MaxUint256)).wait();

  // One-time: stake each solver with >= 1 ether (MINIMUM_STAKE)
  for (const s of solvers) {
    await (await bridge.connect(s).stake({ value: ethers.parseEther("1") })).wait();
  }

  // Prepare constants
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name:  "UltraEfficientIntentBridge",
    version: "1",
    chainId,
    verifyingContract: await bridge.getAddress()
  };
  const amountWei = ethers.parseUnits(CFG.AMOUNT, 18);
  const feeWei    = ethers.parseUnits(CFG.FEE, 18);

  const rows = [];

  for (let trial = 1; trial <= CFG.TRIALS; trial++) {
    const solver = solvers[Math.floor(Math.random() * solvers.length)];
    const now    = Math.floor(Date.now() / 1000);
    const deadline = BigInt(now + CFG.DEADLINE_SECS);

    // Fetch nonce from UEIBB
    const nonce = await bridge.nonces(user.address);

    // Build EIP-712 intent and signatures
    const intentValue = {
      user:     user.address,
      token:    await token.getAddress(),
      amount:   amountWei,
      fee:      feeWei,
      nonce:    nonce,
      deadline: deadline
    };

    // User signs the intent
    const userSig = await user.signTypedData(domain, intentTypes(), intentValue);

    // Compute intentDigest (must match contract's _hashTypedDataV4(IntentStruct))
    const intentDigest = ethers.TypedDataEncoder.hash(domain, intentTypes(), intentValue);

    // Solver signs commitment over the digest
    const solverCommitValue = { intentDigest };
    const solverSig = await solver.signTypedData(domain, solverTypes(), solverCommitValue);

    // Inject solver wait before fulfill (simulated ACK time)
    const base   = randInt(CFG.BASE_ACK_JITTER_MS[0], CFG.BASE_ACK_JITTER_MS[1]);
    const inject = Math.random() < CFG.INJECT_ACK_ANOM_RATE ? CFG.INJECT_ACK_EXTRA_MS : 0;
    const waitMs = base + inject;
    await sleep(waitMs);

    // Solver calls fulfillIntent
    const tx = await bridge.connect(solver).fulfillIntent(
      user.address,
      await token.getAddress(),
      amountWei,
      feeWei,
      deadline,
      userSig,
      solverSig
    );
    const rc = await tx.wait();

    const ackAnomaly = waitMs > CFG.DELTA_ACK_MS;

    rows.push({
      trial,
      solver: solver.address,
      ack_time_ms: waitMs,       // off-chain acknowledge/act latency
      ack_anomaly: ackAnomaly,
      gas_fulfill: Number(rc.gasUsed)
    });

    if (trial % 10 === 0) console.log(`.. trial ${trial}/${CFG.TRIALS}`);
  }

  // ------- Summary -------
  const ack   = rows.map(r => r.ack_time_ms);
  const gasFu = rows.map(r => r.gas_fulfill);
  const anomalies = rows.filter(r => r.ack_anomaly).length;

  console.log("\n=== Summary (UEIBB) ===");
  console.log(`Trials              : ${CFG.TRIALS}`);
  console.log(`Δ_ack (ms)          : ${CFG.DELTA_ACK_MS}`);
  console.log(`ACK mean (ms)       : ${mean(ack).toFixed(2)}`);
  console.log(`ACK std  (ms)       : ${std(ack).toFixed(2)}`);
  console.log(`ACK p25|p50|p75     : ${pct(ack,25).toFixed(1)} | ${pct(ack,50).toFixed(1)} | ${pct(ack,75).toFixed(1)}`);
  console.log(`ACK anomalies count : ${anomalies} (${((anomalies/CFG.TRIALS)*100).toFixed(1)}%)`);
  console.log(`Gas fulfill mean    : ${mean(gasFu).toFixed(2)}`);
  console.log(`Gas fulfill std     : ${std(gasFu).toFixed(2)}`);

  // ASCII histogram for ACK times
  console.log(asciiHistogram(ack, 20, 40, "ACK time (ms)"));

  if (CFG.SAVE_FILES) {
    await ensureDir(outDir);
    const header = "trial,solver,ack_time_ms,ack_anomaly,gas_fulfill\n";
    const csv = header + rows.map(rowToCsv).join("\n");
    await fs.promises.writeFile(jsonOut, JSON.stringify(rows, null, 2));
    await fs.promises.writeFile(csvOut, csv);
    console.log(`Saved -> ${jsonOut}`);
    console.log(`Saved -> ${csvOut}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
