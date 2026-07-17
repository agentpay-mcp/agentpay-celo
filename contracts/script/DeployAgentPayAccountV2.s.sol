// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/AgentPayAccountV2.sol";

interface VmV2Deploy {
    function envAddress(string calldata name) external returns (address);
    function envOr(string calldata name, address defaultValue) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys only the non-upgradeable owner-signed AgentPayAccountV2.
/// @dev The legacy DeployAgentPayAccount script remains available for migration tests only.
contract DeployAgentPayAccountV2 {
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
    uint256 public constant CELO_CHAIN_ID = 42220;
    uint256 public constant CELO_SEPOLIA_CHAIN_ID = 11142220;
    address public constant CELO_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address public constant CELO_SEPOLIA_USDC = 0x01C5C0122039549AD1493B8220cABEdD739BC44E;
    address public constant CELO_SEPOLIA_USDT = 0xd077A400968890Eacc75cdc901F0356c943e4fDb;
    address public constant CELO_SEPOLIA_USDM = 0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b;

    VmV2Deploy internal constant vm = VmV2Deploy(VM_ADDRESS);

    event AgentPayAccountV2Deployed(address indexed account, address indexed owner, address indexed executor);
    error UnsupportedDeployChain(uint256 chainId);
    error MainnetRouteTargetsForbidden(uint256 count);

    function run() external returns (AgentPayAccountV2 account) {
        uint256 deployerPrivateKey = vm.envUint("SETUP_DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("AGENTPAY_OWNER_ADDRESS");
        address executor = vm.envAddress("AGENTPAY_EXECUTOR_ADDRESS");
        address[] memory initialRouteTargets = new address[](0);

        vm.startBroadcast(deployerPrivateKey);
        account = deployForChain(owner, executor, initialRouteTargets, block.chainid);
        vm.stopBroadcast();
    }

    function deploy(address owner, address executor, address[] memory initialRouteTargets)
        public
        returns (AgentPayAccountV2 account)
    {
        account = deployForChain(owner, executor, initialRouteTargets, CELO_CHAIN_ID);
    }

    function deployForChain(address owner, address executor, address[] memory initialRouteTargets, uint256 chainId)
        public
        returns (AgentPayAccountV2 account)
    {
        if (chainId == CELO_CHAIN_ID && initialRouteTargets.length != 0) {
            revert MainnetRouteTargetsForbidden(initialRouteTargets.length);
        }
        account = new AgentPayAccountV2(owner, executor, defaultAllowedTokensForChain(chainId), initialRouteTargets);
        emit AgentPayAccountV2Deployed(address(account), owner, executor);
    }

    function defaultAllowedTokens() public returns (address[] memory tokens) {
        return defaultAllowedTokensForChain(CELO_CHAIN_ID);
    }

    function defaultAllowedTokensForChain(uint256 chainId) public returns (address[] memory tokens) {
        if (chainId == CELO_CHAIN_ID) {
            // Production canary golden path: canonical Celo USDC only.
            // Additional stablecoins are enabled after the bounded canary.
            tokens = new address[](1);
            tokens[0] = CELO_USDC;
            return tokens;
        }
        if (chainId == CELO_SEPOLIA_CHAIN_ID) {
            tokens = new address[](3);
            tokens[0] = vm.envOr("AGENTPAY_CELO_SEPOLIA_USDC_ADDRESS", CELO_SEPOLIA_USDC);
            tokens[1] = vm.envOr("AGENTPAY_CELO_SEPOLIA_USDT_ADDRESS", CELO_SEPOLIA_USDT);
            tokens[2] = vm.envOr("AGENTPAY_CELO_SEPOLIA_USDM_ADDRESS", CELO_SEPOLIA_USDM);
            return tokens;
        }
        revert UnsupportedDeployChain(chainId);
    }
}
