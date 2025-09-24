# Intent-Based Bridge Experiments

This repository contains the experimental framework for evaluating **Intent-Based Bridge (IBB)** protocols versus traditional lock–mint bridges. It supports the thesis _“Beyond Bridges: Intent-Based Models for Blockchain Interoperability”_ by **Jophiel Arevalo Enriquez**.

---

## 📁 Project Structure

```
├── contracts/
│   ├── IntentBridge2.sol        # IBB smart contract
│   ├── TraditionalBridge.sol    # Traditional lock–mint bridge
│   ├── MockToken.sol            # ERC-20 mock token
│   ├── TestToken.sol            # ERC-20 test token

│
├── scripts/
│   ├── BenchMechanisms.js       # Benchmarks solver selection mechanisms
│   ├── Comparison_Final.js      # Compares IBB vs traditional bridge
```

---

## ⚙️ Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Compile Contracts
```bash
npx hardhat compile
```

### 3. Run Local Simulations
#### Benchmark Solver Mechanisms
```bash
npx hardhat run scripts/BenchMechanisms.js
```

#### Compare IBB vs Traditional Bridge
```bash
npx hardhat run scripts/Comparison_Final.js
```

---

## 🧪 Experiment Overview

### ✅ Contracts
- `IntentBridge2.sol`: Implements IBB with dual-lock escrow and solver selection.
- `TraditionalBridge.sol`: Simulates lock–mint bridge flow.
- `MockToken.sol` / `TestToken.sol`: Used for testing token transfers.

### 🧠 Mechanism Evaluation
- **Auction-Based**
- **Randomized Egalitarian Dispatch**
- **Open-Claim Best-Fit**

Benchmarked for:
- Selection latency
- Gas usage
- Fairness

### 🔬 Comparative Analysis
- **Execution latency**: Measured in milliseconds
- **Gas consumption**: Measured in units
- **Efficiency ratio**: IBB vs Traditional

---

## 📊 Results Summary
- IBB reduces latency by ~7.5×
- Gas savings of ~22–59%
- Randomized Dispatch selected as default for benchmarking

---

## 📌 Notes
- Slither analysis is excluded from this README.
- All experiments are run locally using Hardhat.
- Real-world benchmarking uses Etherscan data (not included here).
