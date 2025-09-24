// scripts/benchMechanisms.js
// Benchmark three solver-selection mechanisms against UltraEfficientIntentBridge
// Run: npx hardhat run scripts/benchMechanisms.js

const hre = require("hardhat");
const { ethers } = hre;

// ---------------- Timing helpers ----------------
function nowNs() { return process.hrtime.bigint(); }
function msFrom(t0) { return Number((process.hrtime.bigint() - t0) / 1000000n); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Off-chain selection emulators ----------------
// Fees below are in "token units" (e.g., 0.90 of the token). We'll convert to wei later.
async function selectAuction({ scheduleMs = [0, 40, 80, 120], feeLadder = ["1.00", "0.95", "0.90", "0.85"], acceptIdx = 1 }) {
  const t0 = nowNs();
  for (let i = 0; i < scheduleMs.length; i++) {
    await sleep(i === 0 ? scheduleMs[i] : scheduleMs[i] - scheduleMs[i - 1]);
    if (i === acceptIdx) {
      return { feeTokenUnits: feeLadder[i], T_select_ms: msFrom(t0) };
    }
  }
  return { feeTokenUnits: null, T_select_ms: msFrom(t0), timeout: true };
}

async function selectRandomized({ ackMs = 15, reassigns = 0, reserveFeeTokenUnits = "0.98" }) {
  const t0 = nowNs();
  for (let r = 0; r <= reassigns; r++) {
    await sleep(ackMs);
    if (r === reassigns) {
      return { feeTokenUnits: reserveFeeTokenUnits, T_select_ms: msFrom(t0) };
    }
  }
  return { feeTokenUnits: null, T_select_ms: msFrom(t0), timeout: true };
}

async function selectOpenClaim({ claimWindowMs = 18, processMs = 4, feeTokenUnits = "0.90" }) {
  const t0 = nowNs();
  await sleep(claimWindowMs);
  await sleep(processMs);
  return { feeTokenUnits, T_select_ms: msFrom(t0) };
}

// ---------------- EIP-712 helpers (v6 + v5 fallback) ----------------
function typedDataHash(domain, types, value) {
  // ethers v6
  if (ethers.TypedDataEncoder && ethers.TypedDataEncoder.hash) {
    return ethers.TypedDataEncoder.hash(domain, types, value);
  }
  // ethers v5 fallback (lazy import)
  try {
    const { _TypedDataEncoder } = require("@ethersproject/hash");
    return _TypedDataEncoder.hash(domain, types, value);
  } catch (e) {
    throw new Error("No TypedDataEncoder available (ethers v5/v6 not detected).");
  }
}

async function signTyped(signer, domain, types, value) {
  if (typeof signer.signTypedData === "function") {
    return signer.signTypedData(domain, types, value); // ethers v6
  }
  if (typeof signer._signTypedData === "function") {
    return signer._signTypedData(domain, types, value); // ethers v5
  }
  throw new Error("Signer does not support EIP-712 typed-data signing");
}

const TYPES_INTENT = {
  Intent: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const TYPES_SOLVER_COMMIT = {
  SolverCommitment: [{ name: "intentDigest", type: "bytes32" }],
};

// ---------------- Deployments ----------------
async function deployBridgeAndToken() {
  const [deployer, user, solver] = await ethers.getSigners();

  // Use local MockToken (ensure contracts/MockToken.sol exists)
  const ERC20F = await ethers.getContractFactory("MockToken");
  const token = await ERC20F.deploy();
  await token.waitForDeployment();

  const Bridge = await ethers.getContractFactory("UltraEfficientIntentBridge");
  const bridge = await Bridge.deploy();
  await bridge.waitForDeployment();

  return { deployer, user, solver, token, bridge };
}

async function prepareBalancesAndStake({ user, solver, token, bridge }) {
  // Mint a large balance for the user and approve the bridge to pull funds
  const bigMint = ethers.parseUnits("1000000", 18); // 1,000,000 TTK for tests
  await (await token.connect(user).mint(user.address, bigMint)).wait();
  const bridgeAddr = bridge.target ?? bridge.address;
  await (await token.connect(user).approve(bridgeAddr, ethers.MaxUint256)).wait();

  // Stake 1 ETH from solver (satisfy MINIMUM_STAKE)
  await (await bridge.connect(solver).stake({ value: ethers.parseEther("1.0") })).wait();
}

// ---------------- E2E trial (one fulfillIntent call) ----------------
async function runTrial({
  label,
  amountUnits = "10.00",             // 10 TTK
  selection,                           // async () => { feeTokenUnits, T_select_ms }
  domain,                              // EIP-712 domain
  signers,                             // { user, solver }
  contracts,                           // { token, bridge }
}) {
  const { user, solver } = signers;
  const { token, bridge } = contracts;

  // 1) Off-chain selection
  const sel = await selection();
  if (sel.timeout || !sel.feeTokenUnits) {
    return { ok: false, reason: "selection-timeout" };
  }

  const decimals = await token.decimals();
  const amount = ethers.parseUnits(amountUnits, decimals);
  const fee = ethers.parseUnits(sel.feeTokenUnits, decimals);

  // 2) Prepare typed data values
  const nonce = await bridge.nonces(user.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // +1h

  const intentValue = {
    user: user.address,
    token: token.target ?? token.address,
    amount,
    fee,
    nonce,
    deadline,
  };

  // 3) User signs Intent
  const userSignature = await signTyped(user, domain, TYPES_INTENT, intentValue);

  // 4) Compute intentDigest (EIP-712) for solver commitment
  const intentDigest = typedDataHash(domain, TYPES_INTENT, intentValue);

  // 5) Solver signs SolverCommitment(intentDigest)
  const solverSignature = await signTyped(solver, domain, TYPES_SOLVER_COMMIT, { intentDigest });

  // 6) On-chain fulfillIntent by solver (measure tx latency + gas)
  const tTx0 = nowNs();
  const tx = await bridge.connect(solver).fulfillIntent(
    user.address,
    token.target ?? token.address,
    amount,
    fee,
    deadline,
    userSignature,
    solverSignature
  );
  const receipt = await tx.wait();
  const T_tx_ms = msFrom(tTx0);

  // 7) Combine and return metrics
  const T_select_ms = sel.T_select_ms;
  const T_e2e_ms = T_select_ms + T_tx_ms;

  return {
    ok: true,
    label,
    T_select_ms,
    T_tx_ms,
    T_e2e_ms,
    gas_fulfillIntent: receipt.gasUsed.toString(),
    feeTokenUnits: sel.feeTokenUnits,
  };
}

// ---------------- Main harness ----------------
async function main() {
  const { deployer, user, solver, token, bridge } = await deployBridgeAndToken();
  await prepareBalancesAndStake({ user, solver, token, bridge });

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const bridgeAddr = bridge.target ?? bridge.address;

  const domain = {
    name: "UltraEfficientIntentBridge",
    version: "1",
    chainId,
    verifyingContract: bridgeAddr,
  };

  const N = 20; // trials per mechanism

  // Mechanism parameterizations (tune as needed)
  const auctionSel = () => selectAuction({
    scheduleMs: [0, 40, 80, 120],
    feeLadder: ["1.00", "0.95", "0.90", "0.85"],
    acceptIdx: 1,
  });

  const randomizedSel = (i) => selectRandomized({
    ackMs: 15,
    reassigns: i % 3 === 0 ? 1 : 0,
    reserveFeeTokenUnits: "0.98",
  });

  const openClaimSel = (i) => selectOpenClaim({
    claimWindowMs: 18 + (i % 5),
    processMs: 4,
    feeTokenUnits: "0.90",
  });

  const signers = { user, solver };
  const contracts = { token, bridge };

  const resA = [];
  const resB = [];
  const resC = [];

  for (let i = 0; i < N; i++) {
    resA.push(await runTrial({
      label: "Auction",
      amountUnits: "10.00",
      selection: auctionSel,
      domain,
      signers,
      contracts,
    }));
  }

  for (let i = 0; i < N; i++) {
    resB.push(await runTrial({
      label: "Randomized",
      amountUnits: "10.00",
      selection: () => randomizedSel(i),
      domain,
      signers,
      contracts,
    }));
  }

  for (let i = 0; i < N; i++) {
    resC.push(await runTrial({
      label: "OpenClaim",
      amountUnits: "10.00",
      selection: () => openClaimSel(i),
      domain,
      signers,
      contracts,
    }));
  }

  function summarize(arr) {
    const okArr = arr.filter(r => r.ok);
    const n = okArr.length || 1;
    const toNum = x => Number(x);
    const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const mSel = Math.round(mean(okArr.map(r => r.T_select_ms)));
    const mTx = Math.round(mean(okArr.map(r => r.T_tx_ms)));
    const mE2E = Math.round(mean(okArr.map(r => r.T_e2e_ms)));
    const mGas = Math.round(mean(okArr.map(r => toNum(r.gas_fulfillIntent))));
    const mFee = mean(okArr.map(r => parseFloat(r.feeTokenUnits)));
    return { n, mSel, mTx, mE2E, mGas, mFee };
  }

  const SA = summarize(resA);
  const SB = summarize(resB);
  const SC = summarize(resC);

  

  // Optional sanity: gas similarity across mechanisms (same on-chain path)
  const within = (a, b, tol) => Math.abs(a - b) <= tol;
  const tolGas = 10_000;
  if (!(within(SA.mGas, SB.mGas, tolGas) && within(SA.mGas, SC.mGas, tolGas))) {
    console.warn("⚠️ Gas across mechanisms differs more than tolerance—did on-chain logic diverge?");
  }

  // ──────────────────────────────────────────────────────────────
  // Pretty table summary (visual)
  // ──────────────────────────────────────────────────────────────
  const toRow = (name, S) => ({
    Mechanism: name,
    Trials: S.n,
    'Mean Tselect (ms)': S.mSel,
    'Mean Ttx (ms)': S.mTx,
    'Mean Te2e (ms)': S.mE2E,
    'Mean Gas fulfillIntent': S.mGas,
  });

  const tableRows = [
    toRow('Auction', SA),
    toRow('Randomized', SB),
    toRow('OpenClaim', SC),
  ];

  console.log('\n=== Bench Summary (table) ===');
  console.table(tableRows);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
