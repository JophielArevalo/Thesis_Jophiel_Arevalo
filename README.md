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



## ⚙️ Hardhat Installation & Setup

Hardhat is a development environment for Ethereum smart contracts. Follow these steps to install and configure it for this project.

### 🔧 Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v16 or later recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Git](https://git-scm.com/) (optional, for version control)

### 📦 Step-by-Step Installation

#### 1. Initialize Hardhat (if not already initialized)

```bash
npx hardhat
```

Choose **“Create a JavaScript project”** when prompted.

#### 2. Install Dependencies

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox dotenv
```

This installs:

- Hardhat core
- Toolbox (includes Ethers.js, Waffle, Chai, etc.)
- Dotenv for managing environment variables

### 3. Compile Contracts
```bash
npx hardhat compile
```

### 4. Run Local Simulations
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
