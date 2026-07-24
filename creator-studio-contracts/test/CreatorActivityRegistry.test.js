const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("CreatorActivityRegistry", function () {
  async function deployRegistry() {
    const [owner, actor, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CreatorActivityRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();
    return { registry, owner, actor, other };
  }

  it("records activities from the owner", async function () {
    const { registry, actor } = await deployRegistry();
    const activityType = ethers.id("game-created");
    const metadataHash = ethers.id("metadata");

    await expect(
      registry.recordActivity(actor.address, activityType, "game-1", "0g://root", metadataHash)
    ).to.emit(registry, "ActivityRecorded")
      .withArgs(1, actor.address, activityType, "game-1", "0g://root", metadataHash, anyValue);

    const activity = await registry.activities(1);
    expect(activity.actor).to.equal(actor.address);
    expect(activity.activityType).to.equal(activityType);
    expect(activity.entityId).to.equal("game-1");
    expect(activity.metadataURI).to.equal("0g://root");
    expect(activity.metadataHash).to.equal(metadataHash);
  });

  it("rejects non-owner writes", async function () {
    const { registry, actor, other } = await deployRegistry();
    await expect(
      registry.connect(other).recordActivity(actor.address, ethers.id("game-created"), "game-1", "0g://root", ethers.id("metadata"))
    ).to.be.revertedWithCustomError(registry, "NotOwner");
  });

  it("can pause writes", async function () {
    const { registry, actor } = await deployRegistry();
    await registry.pause();
    await expect(
      registry.recordActivity(actor.address, ethers.id("game-created"), "game-1", "0g://root", ethers.id("metadata"))
    ).to.be.revertedWithCustomError(registry, "PausedRegistry");
  });
});
