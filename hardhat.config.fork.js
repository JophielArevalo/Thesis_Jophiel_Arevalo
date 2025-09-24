require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-network-helpers');

module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: process.env.ALCHEMY_URL,
        blockNumber: 19400000 // Recent stable block
      }
    }
  },
  solidity: '0.8.20'
};