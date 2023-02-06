import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  ChildERC20Predicate,
  L2StateSender,
  StateReceiver,
  ChildERC20,
  NativeERC20,
  ChildERC20__factory,
} from "../../typechain-types";
import {
  setCode,
  setBalance,
  impersonateAccount,
  stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { smock } from "@defi-wonderland/smock";
import { alwaysTrueBytecode } from "../constants";

describe("ChildERC20Predicate", () => {
  let childERC20Predicate: ChildERC20Predicate,
    systemChildERC20Predicate: ChildERC20Predicate,
    stateReceiverChildERC20Predicate: ChildERC20Predicate,
    l2StateSender: L2StateSender,
    stateReceiver: StateReceiver,
    rootERC20Predicate: string,
    childERC20: ChildERC20,
    nativeERC20: NativeERC20,
    nativeERC20RootToken: string,
    totalSupply: number = 0,
    accounts: SignerWithAddress[];
  before(async () => {
    accounts = await ethers.getSigners();

    const L2StateSender = await ethers.getContractFactory("L2StateSender");
    l2StateSender = (await L2StateSender.deploy()) as L2StateSender;

    await l2StateSender.deployed();

    const StateReceiver = await ethers.getContractFactory("StateReceiver");
    stateReceiver = (await StateReceiver.deploy()) as unknown as StateReceiver;

    await stateReceiver.deployed();

    rootERC20Predicate = ethers.Wallet.createRandom().address;

    const ChildERC20 = await ethers.getContractFactory("ChildERC20");
    childERC20 = (await ChildERC20.deploy()) as ChildERC20;

    await childERC20.deployed();

    const ChildERC20Predicate = await ethers.getContractFactory("ChildERC20Predicate");
    childERC20Predicate = (await ChildERC20Predicate.deploy()) as ChildERC20Predicate;

    await childERC20Predicate.deployed();

    const NativeERC20 = await ethers.getContractFactory("NativeERC20");

    const tempNativeERC20 = await NativeERC20.deploy();

    await tempNativeERC20.deployed();

    await setCode(
      "0x0000000000000000000000000000000000001010",
      await network.provider.send("eth_getCode", [tempNativeERC20.address])
    ); // Mock genesis NativeERC20 deployment

    nativeERC20 = NativeERC20.attach("0x0000000000000000000000000000000000001010") as NativeERC20;

    await setCode("0x0000000000000000000000000000000000002020", alwaysTrueBytecode); // Mock NATIVE_TRANSFER_PRECOMPILE

    nativeERC20RootToken = ethers.Wallet.createRandom().address;

    impersonateAccount("0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE");
    setBalance("0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE", "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");

    systemChildERC20Predicate = childERC20Predicate.connect(
      await ethers.getSigner("0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE")
    );

    impersonateAccount(stateReceiver.address);
    setBalance(stateReceiver.address, "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    stateReceiverChildERC20Predicate = childERC20Predicate.connect(await ethers.getSigner(stateReceiver.address));
  });

  it("fail initialization: unauthorized", async () => {
    await expect(
      childERC20Predicate.initialize(
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "",
        "",
        0
      )
    )
      .to.be.revertedWithCustomError(childERC20Predicate, "Unauthorized")
      .withArgs("SYSTEMCALL");
  });

  it("fail bad initialization", async () => {
    await expect(
      systemChildERC20Predicate.initialize(
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "",
        "",
        0
      )
    ).to.be.revertedWith("ChildERC20Predicate: BAD_INITIALIZATION");
  });

  it("initialize and validate initialization", async () => {
    await systemChildERC20Predicate.initialize(
      l2StateSender.address,
      stateReceiver.address,
      rootERC20Predicate,
      childERC20.address,
      nativeERC20RootToken,
      "TEST",
      "TEST",
      18
    );

    expect(await childERC20Predicate.l2StateSender()).to.equal(l2StateSender.address);
    expect(await childERC20Predicate.stateReceiver()).to.equal(stateReceiver.address);
    expect(await childERC20Predicate.rootERC20Predicate()).to.equal(rootERC20Predicate);
    expect(await childERC20Predicate.childTokenTemplate()).to.equal(childERC20.address);
  });

  it("fail reinitialization", async () => {
    await expect(
      systemChildERC20Predicate.initialize(
        l2StateSender.address,
        stateReceiver.address,
        rootERC20Predicate,
        childERC20.address,
        nativeERC20RootToken,
        "TEST",
        "TEST",
        18
      )
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("deposit tokens from root chain with same address", async () => {
    const randomAmount = Math.floor(Math.random() * 1000000 + 1);
    totalSupply += randomAmount;
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        nativeERC20RootToken,
        nativeERC20.address,
        accounts[0].address,
        accounts[0].address,
        ethers.utils.parseUnits(String(randomAmount)),
      ]
    );
    const depositTx = await stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData);
    const depositReceipt = await depositTx.wait();
    stopImpersonatingAccount(stateReceiverChildERC20Predicate.address);
    const depositEvent = depositReceipt.events?.find((log) => log.event === "L2ERC20Deposit");
    expect(depositEvent?.args?.rootToken).to.equal(nativeERC20RootToken);
    expect(depositEvent?.args?.childToken).to.equal(nativeERC20.address);
    expect(depositEvent?.args?.sender).to.equal(accounts[0].address);
    expect(depositEvent?.args?.receiver).to.equal(accounts[0].address);
    expect(depositEvent?.args?.amount).to.equal(ethers.utils.parseUnits(String(randomAmount)));
  });

  it("deposit tokens from root chain with different address", async () => {
    const randomAmount = Math.floor(Math.random() * 1000000 + 1);
    totalSupply += randomAmount;
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        nativeERC20RootToken,
        nativeERC20.address,
        accounts[0].address,
        accounts[1].address,
        ethers.utils.parseUnits(String(randomAmount)),
      ]
    );
    const depositTx = await stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData);
    const depositReceipt = await depositTx.wait();
    const depositEvent = depositReceipt.events?.find((log) => log.event === "L2ERC20Deposit");
    expect(depositEvent?.args?.rootToken).to.equal(nativeERC20RootToken);
    expect(depositEvent?.args?.childToken).to.equal(nativeERC20.address);
    expect(depositEvent?.args?.sender).to.equal(accounts[0].address);
    expect(depositEvent?.args?.receiver).to.equal(accounts[1].address);
    expect(depositEvent?.args?.amount).to.equal(ethers.utils.parseUnits(String(randomAmount)));
  });

  it("fail deploy new child token: invalid root token", async () => {
    await expect(
      childERC20Predicate.deployChildToken(
        "0x0000000000000000000000000000000000000000",
        ethers.utils.randomBytes(32),
        "TEST1",
        "TEST1",
        18
      )
    ).to.be.revertedWith("ChildERC20Predicate: INVALID_ROOT_TOKEN");
  });

  it("deploy new child token", async () => {
    const rootToken = ethers.Wallet.createRandom().address;
    const mapTx = await childERC20Predicate.deployChildToken(
      rootToken,
      ethers.utils.randomBytes(32),
      "TEST1",
      "TEST1",
      18
    );
    const mapReceipt = await mapTx.wait();
    const mapEvent = mapReceipt.events?.find((log) => log.event === "L2TokenMapped");
    expect(await childERC20Predicate.childTokenToRootToken(mapEvent?.args?.childToken)).to.equal(rootToken);
    expect(mapEvent?.args?.rootToken).to.equal(rootToken);
  });

  it("withdraw tokens from child chain with same address", async () => {
    const randomAmount = Math.floor(Math.random() * (totalSupply - 10) + 1);
    totalSupply -= randomAmount;
    const depositTx = await childERC20Predicate.withdraw(
      nativeERC20.address,
      ethers.utils.parseUnits(String(randomAmount))
    );
    const depositReceipt = await depositTx.wait();
    const depositEvent = depositReceipt.events?.find((log) => log.event === "L2ERC20Withdraw");
    expect(depositEvent?.args?.rootToken).to.equal(nativeERC20RootToken);
    expect(depositEvent?.args?.childToken).to.equal(nativeERC20.address);
    expect(depositEvent?.args?.sender).to.equal(accounts[0].address);
    expect(depositEvent?.args?.receiver).to.equal(accounts[0].address);
    expect(depositEvent?.args?.amount).to.equal(ethers.utils.parseUnits(String(randomAmount)));
  });

  it("withdraw tokens from child chain with same address", async () => {
    const randomAmount = Math.floor(Math.random() * (totalSupply - 10) + 1);
    totalSupply -= randomAmount;
    const depositTx = await childERC20Predicate.withdrawTo(
      nativeERC20.address,
      accounts[1].address,
      ethers.utils.parseUnits(String(randomAmount))
    );
    const depositReceipt = await depositTx.wait();
    const depositEvent = depositReceipt.events?.find((log) => log.event === "L2ERC20Withdraw");
    expect(depositEvent?.args?.rootToken).to.equal(nativeERC20RootToken);
    expect(depositEvent?.args?.childToken).to.equal(nativeERC20.address);
    expect(depositEvent?.args?.sender).to.equal(accounts[0].address);
    expect(depositEvent?.args?.receiver).to.equal(accounts[1].address);
    expect(depositEvent?.args?.amount).to.equal(ethers.utils.parseUnits(String(randomAmount)));
  });

  it("fail deposit tokens: only state receiver", async () => {
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        "0x0000000000000000000000000000000000000000",
        accounts[0].address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(childERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)).to.be.revertedWith(
      "ChildERC20Predicate: ONLY_STATE_RECEIVER"
    );
  });

  it("fail deposit tokens: only root predicate", async () => {
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        "0x0000000000000000000000000000000000000000",
        accounts[0].address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, ethers.Wallet.createRandom().address, stateSyncData)
    ).to.be.revertedWith("ChildERC20Predicate: ONLY_ROOT_PREDICATE");
  });

  it("fail deposit tokens: invalid signature", async () => {
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.randomBytes(32),
        nativeERC20RootToken,
        nativeERC20.address,
        accounts[0].address,
        accounts[0].address,
        1,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWith("ChildERC20Predicate: INVALID_SIGNATURE");
  });

  it("fail deposit tokens of unknown child token: not a contract", async () => {
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        "0x0000000000000000000000000000000000000000",
        ethers.Wallet.createRandom().address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWith("ChildERC20Predicate: NOT_CONTRACT");
  });

  it("fail withdraw tokens of unknown child token: not a contract", async () => {
    await expect(childERC20Predicate.withdraw(ethers.Wallet.createRandom().address, 1)).to.be.revertedWith(
      "ChildERC20Predicate: NOT_CONTRACT"
    );
  });

  it("fail deposit tokens of unknown child token: wrong deposit token", async () => {
    childERC20Predicate.connect(await ethers.getSigner(stateReceiver.address));
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        "0x0000000000000000000000000000000000000000",
        nativeERC20.address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWith("ChildERC20Predicate: WRONG_DEPOSIT_TOKEN");
  });

  it("fail deposit tokens of unknown child token: unmapped token", async () => {
    const rootToken = ethers.Wallet.createRandom().address;
    const childToken = await (await ethers.getContractFactory("ChildERC20")).deploy();
    await childToken.initialize(rootToken, "TEST", "TEST", 18);
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        rootToken,
        childToken.address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWith("ChildERC20Predicate: UNMAPPED_TOKEN");
  });

  it("fail withdraw tokens of unknown child token: unmapped token", async () => {
    const rootToken = ethers.Wallet.createRandom().address;
    const childToken = await (await ethers.getContractFactory("ChildERC20")).deploy();
    await childToken.initialize(rootToken, "TEST", "TEST", 18);
    await expect(stateReceiverChildERC20Predicate.withdraw(childToken.address, 1)).to.be.revertedWith(
      "ChildERC20Predicate: UNMAPPED_TOKEN"
    );
  });

  it("fail deposit tokens of unknown child token: assert non-zero root token", async () => {
    const childToken = await (await smock.mock<ChildERC20__factory>("ChildERC20")).deploy();
    await childToken.initialize(ethers.Wallet.createRandom().address, "TEST", "TEST", 18);
    childToken.setVariable("_rootToken", "0x0000000000000000000000000000000000000000");
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        "0x0000000000000000000000000000000000000000",
        childToken.address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWithPanic();
  });

  it("fail deposit tokens of unknown child token: assert incorrect predicate", async () => {
    const childToken = await (await smock.mock<ChildERC20__factory>("ChildERC20")).deploy();
    await childToken.initialize(ethers.Wallet.createRandom().address, "TEST", "TEST", 18);
    childToken.setVariable("_rootToken", "0x0000000000000000000000000000000000000000");
    childToken.setVariable("_predicate", ethers.Wallet.createRandom().address);
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        "0x0000000000000000000000000000000000000000",
        childToken.address,
        accounts[0].address,
        accounts[0].address,
        0,
      ]
    );
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWithPanic();
  });

  // since we fake NativeERC20 here, keep this function last:
  it("fail deposit tokens: mint failed", async () => {
    const stateSyncData = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "address", "address", "address", "uint256"],
      [
        ethers.utils.solidityKeccak256(["string"], ["DEPOSIT"]),
        nativeERC20RootToken,
        nativeERC20.address,
        accounts[0].address,
        accounts[0].address,
        1,
      ]
    );
    const fakeNativeERC20 = await smock.fake<NativeERC20>("NativeERC20", {
      address: "0x0000000000000000000000000000000000001010",
    });
    fakeNativeERC20.rootToken.returns(nativeERC20RootToken);
    fakeNativeERC20.predicate.returns(stateReceiverChildERC20Predicate.address);
    fakeNativeERC20.mint.returns(false);
    await expect(
      stateReceiverChildERC20Predicate.onStateReceive(0, rootERC20Predicate, stateSyncData)
    ).to.be.revertedWith("ChildERC20Predicate: MINT_FAILED");
    fakeNativeERC20.mint.returns();
  });

  it("fail withdraw tokens: burn failed", async () => {
    const fakeNativeERC20 = await smock.fake<NativeERC20>("NativeERC20", {
      address: "0x0000000000000000000000000000000000001010",
    });
    fakeNativeERC20.rootToken.returns(nativeERC20RootToken);
    fakeNativeERC20.predicate.returns(stateReceiverChildERC20Predicate.address);
    fakeNativeERC20.burn.returns(false);
    await expect(stateReceiverChildERC20Predicate.withdraw(nativeERC20.address, 1)).to.be.revertedWith(
      "ChildERC20Predicate: BURN_FAILED"
    );
    fakeNativeERC20.mint.returns();
  });
});
