// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract CreatorActivityRegistry {
    struct Activity {
        address actor;
        bytes32 activityType;
        string entityId;
        string metadataURI;
        bytes32 metadataHash;
        uint256 timestamp;
    }

    address public owner;
    bool public paused;
    uint256 public nextActivityId = 1;

    mapping(uint256 => Activity) public activities;

    event ActivityRecorded(
        uint256 indexed activityId,
        address indexed actor,
        bytes32 indexed activityType,
        string entityId,
        string metadataURI,
        bytes32 metadataHash,
        uint256 timestamp
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error NotOwner();
    error PausedRegistry();
    error InvalidActor();
    error InvalidActivityType();
    error InvalidMetadataHash();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedRegistry();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidActor();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function recordActivity(
        address actor,
        bytes32 activityType,
        string calldata entityId,
        string calldata metadataURI,
        bytes32 metadataHash
    ) external onlyOwner whenNotPaused returns (uint256 activityId) {
        if (actor == address(0)) revert InvalidActor();
        if (activityType == bytes32(0)) revert InvalidActivityType();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();

        activityId = nextActivityId;
        nextActivityId = activityId + 1;

        uint256 timestamp = block.timestamp;
        activities[activityId] = Activity({
            actor: actor,
            activityType: activityType,
            entityId: entityId,
            metadataURI: metadataURI,
            metadataHash: metadataHash,
            timestamp: timestamp
        });

        emit ActivityRecorded(activityId, actor, activityType, entityId, metadataURI, metadataHash, timestamp);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidActor();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
