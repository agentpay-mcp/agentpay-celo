// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../script/DeployAgentPayAccount.s.sol";
import "../src/AgentPayAccount.sol";

contract DeployAgentPayAccountTest {
    address private constant OWNER = address(0x1234);
    address private constant EXECUTOR = address(0x5678);
    address private constant ROUTE_TARGET = address(0x7777);
    address private constant CELO_SEPOLIA_USDC = 0x01C5C0122039549AD1493B8220cABEdD739BC44E;
    address private constant CELO_SEPOLIA_USDT = 0xd077A400968890Eacc75cdc901F0356c943e4fDb;
    address private constant CELO_SEPOLIA_USDM = 0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b;

    function testLegacyMainnetDeployHelperIsDisabled() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory routeTargets = new address[](1);
        routeTargets[0] = ROUTE_TARGET;

        try deployer.deploy(OWNER, EXECUTOR, routeTargets) returns (AgentPayAccount) {
            assert(false);
        } catch (bytes memory reason) {
            assert(_errorSelector(reason) == DeployAgentPayAccount.LegacyMainnetDeploymentDisabled.selector);
        }
    }

    function testLegacyMainnetDeployForChainHelperIsDisabled() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory routeTargets = new address[](0);

        try deployer.deployForChain(OWNER, EXECUTOR, routeTargets, 42220) returns (AgentPayAccount) {
            assert(false);
        } catch (bytes memory reason) {
            assert(_errorSelector(reason) == DeployAgentPayAccount.LegacyMainnetDeploymentDisabled.selector);
        }
    }

    function testLegacyMainnetTokenHelperIsDisabled() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();

        try deployer.defaultAllowedTokens() returns (address[] memory) {
            assert(false);
        } catch (bytes memory reason) {
            assert(_errorSelector(reason) == DeployAgentPayAccount.LegacyMainnetDeploymentDisabled.selector);
        }
    }

    function testDefaultAllowedTokensSupportCeloSepoliaStablecoins() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory tokens = deployer.defaultAllowedTokensForChain(11142220);

        assert(deployer.CELO_SEPOLIA_USDC() == CELO_SEPOLIA_USDC);
        assert(deployer.CELO_SEPOLIA_USDT() == CELO_SEPOLIA_USDT);
        assert(deployer.CELO_SEPOLIA_USDM() == CELO_SEPOLIA_USDM);
        assert(tokens.length == 3);
        assert(tokens[0] != tokens[1]);
        assert(tokens[1] != tokens[2]);
    }

    function _errorSelector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(reason, 32))
        }
    }
}
