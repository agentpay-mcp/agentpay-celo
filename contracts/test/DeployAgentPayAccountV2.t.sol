// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../script/DeployAgentPayAccountV2.s.sol";
import "../src/AgentPayAccountV2.sol";

contract DeployAgentPayAccountV2Test {
    address private constant OWNER = address(0x1234);
    address private constant EXECUTOR = address(0x5678);
    address private constant ROUTE_TARGET = address(0x7777);
    address private constant CELO_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address private constant CELO_USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address private constant CELO_SEPOLIA_USDC = 0x01C5C0122039549AD1493B8220cABEdD739BC44E;
    address private constant CELO_SEPOLIA_USDT = 0xd077A400968890Eacc75cdc901F0356c943e4fDb;
    address private constant CELO_SEPOLIA_USDM = 0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b;

    function testDeploysOwnerSignedV2WithDefaultStableTokenAllowlist() public {
        DeployAgentPayAccountV2 deployer = new DeployAgentPayAccountV2();
        address[] memory routeTargets = new address[](0);

        AgentPayAccountV2 account = deployer.deploy(OWNER, EXECUTOR, routeTargets);

        assert(account.owner() == OWNER);
        assert(account.executor() == EXECUTOR);
        assert(account.allowedTokens(CELO_USDC));
        assert(!account.allowedTokens(CELO_USDT));
        assert(!account.allowedRouteTargets(ROUTE_TARGET));
        assert(account.domainSeparator() != bytes32(0));
    }

    function testDefaultAllowedTokensUseTheCeloMainnetUSDCGoldenPath() public {
        DeployAgentPayAccountV2 deployer = new DeployAgentPayAccountV2();
        address[] memory tokens = deployer.defaultAllowedTokens();

        assert(tokens.length == 1);
        assert(tokens[0] == CELO_USDC);
    }

    function testMainnetDeploymentSurfaceRejectsNonUSDCStablecoins() public {
        DeployAgentPayAccountV2 deployer = new DeployAgentPayAccountV2();
        AgentPayAccountV2 account = deployer.deploy(OWNER, EXECUTOR, new address[](0));

        assert(account.allowedTokens(CELO_USDC));
        assert(!account.allowedTokens(CELO_USDT));
    }

    function testMainnetDeploymentSurfaceRejectsRouteTargets() public {
        DeployAgentPayAccountV2 deployer = new DeployAgentPayAccountV2();
        address[] memory routeTargets = new address[](1);
        routeTargets[0] = ROUTE_TARGET;

        bool reverted;
        try deployer.deploy(OWNER, EXECUTOR, routeTargets) returns (AgentPayAccountV2) {
            reverted = false;
        } catch (bytes memory reason) {
            reverted = reason.length >= 4;
        }

        assert(reverted);
    }

    function testSepoliaDeploymentSurfaceKeepsCanonicalCeloStablecoins() public {
        DeployAgentPayAccountV2 deployer = new DeployAgentPayAccountV2();
        address[] memory tokens = deployer.defaultAllowedTokensForChain(11142220);

        assert(tokens.length == 3);
        assert(tokens[0] == CELO_SEPOLIA_USDC);
        assert(tokens[1] == CELO_SEPOLIA_USDT);
        assert(tokens[2] == CELO_SEPOLIA_USDM);
    }

    function testUnsupportedChainReverts() public {
        DeployAgentPayAccountV2 deployer = new DeployAgentPayAccountV2();
        bool reverted;

        try deployer.defaultAllowedTokensForChain(1) returns (address[] memory) {
            reverted = false;
        } catch (bytes memory reason) {
            reverted = reason.length >= 4;
        }

        assert(reverted);
    }
}
