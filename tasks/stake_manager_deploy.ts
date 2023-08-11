import { task } from "hardhat/config";
const fs = require("fs");

// npx hardhat stake_manager_deploy "./tasks/genesis_TEST_2.json" "http://127.0.0.1:8545/" "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" "0xD5bFeBDce5c91413E41cc7B24C8402c59A344f7c" "./tasks/" "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"

task("stake_manager_deploy", "Deploy StakeManager")
  .addPositionalParam("genesis")
  .addPositionalParam("jsonRPC")
  .addPositionalParam("deployerKey")
  .addPositionalParam("stakeTokenAddress")
  .addPositionalParam("genesisOut")
  .addPositionalParam("adminKey")
  .setAction(async (args, hre) => {
    const ethers = hre.ethers;
    const provider = new ethers.providers.JsonRpcProvider(args.jsonRPC);
    const admin = args.adminKey;
    const deployer = new ethers.Wallet(args.deployerKey, provider);

    // StakeToken Address
    const stakeTokenAddress = args.stakeTokenAddress;

    // Deploy StakeManager
    const stakeManagerAddress = await deployStakeManager(stakeTokenAddress);

    // Update genesis.json
    // - StakeManageerAddr
    updateGenesis(args.genesis, stakeManagerAddress);

    async function deployStakeManager(stakeTokenAddress: string) {
      // Deploy StakeManager (implementation)
      const StakeManager = await ethers.getContractFactory("StakeManager", deployer);
      const stakeManager = await StakeManager.deploy();

      // Deploy proxy StakeManager and initialise
      const Proxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
      const stakeManagerInit = stakeManager.interface.encodeFunctionData("initialize", [stakeTokenAddress]);
      const proxy = await Proxy.deploy(stakeManager.address, admin, stakeManagerInit);

      return proxy.address;
    }

    function updateGenesis(path: string, stakeManagerAddress: string) {
      const json = fs.readFileSync(path);
      const genesis = JSON.parse(json);
      genesis["params"]["engine"]["polybft"]["bridge"] = { stakeManagerAddr: stakeManagerAddress };
      const updated = JSON.stringify(genesis, null, 4);

      // write the JSON to file
      fs.writeFileSync(`${args.genesisOut}/genesis.json`, updated, (error: any) => {
        if (error) {
          console.error(error);
          throw error;
        }

        console.log("Updated genesis.json with StakeManager address");
      });
    }
  });
