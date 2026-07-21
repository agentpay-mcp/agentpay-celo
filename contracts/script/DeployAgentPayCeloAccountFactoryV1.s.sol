// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPayCeloAccountFactoryV1} from "../src/AgentPayCeloAccountFactoryV1.sol";

interface VmCeloFactoryDeploy {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployAgentPayCeloAccountFactoryV1 {
    error UnsupportedDeployChain(uint256 chainId);

    event AgentPayCeloAccountFactoryV1Deployed(
        address indexed factory,
        address indexed executor,
        address indexed usdc,
        bytes32 policyVersion,
        bytes32 factoryRuntimeHash,
        bytes32 accountCreationCodeHash
    );

    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
    uint256 public constant CELO_CHAIN_ID = 42220;

    VmCeloFactoryDeploy internal constant vm = VmCeloFactoryDeploy(VM_ADDRESS);

    function run() external returns (AgentPayCeloAccountFactoryV1 factory) {
        _requireMainnet();
        uint256 deployerPrivateKey = vm.envUint("SETUP_DEPLOYER_PRIVATE_KEY");
        address executor = vm.envAddress("AGENTPAY_EXECUTOR_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        factory = deploy(executor);
        vm.stopBroadcast();
    }

    function deploy(address executor) public returns (AgentPayCeloAccountFactoryV1 factory) {
        _requireMainnet();
        factory = new AgentPayCeloAccountFactoryV1(executor);
        emit AgentPayCeloAccountFactoryV1Deployed(
            address(factory),
            factory.executor(),
            factory.USDC(),
            factory.POLICY_VERSION(),
            address(factory).codehash,
            factory.accountCreationCodeHash()
        );
    }

    function _requireMainnet() private view {
        if (block.chainid != CELO_CHAIN_ID) revert UnsupportedDeployChain(block.chainid);
    }
}
