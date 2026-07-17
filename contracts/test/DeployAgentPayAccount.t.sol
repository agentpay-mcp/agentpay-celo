// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../script/DeployAgentPayAccount.s.sol";
import "../src/AgentPayAccount.sol";

contract DeployAgentPayAccountTest {
    address private constant OWNER = address(0x1234);
    address private constant EXECUTOR = address(0x5678);
    address private constant ROUTE_TARGET = address(0x7777);
    address private constant CELO_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address private constant CELO_USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address private constant CELO_USDM = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address private constant CELO_SEPOLIA_USDC = 0x01C5C0122039549AD1493B8220cABEdD739BC44E;
    address private constant CELO_SEPOLIA_USDT = 0xd077A400968890Eacc75cdc901F0356c943e4fDb;
    address private constant CELO_SEPOLIA_USDM = 0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b;

    function testDeploysAccountWithDefaultStableTokenAllowlist() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory routeTargets = new address[](1);
        routeTargets[0] = ROUTE_TARGET;

        AgentPayAccount account = deployer.deploy(OWNER, EXECUTOR, routeTargets);

        assert(account.owner() == OWNER);
        assert(account.executor() == EXECUTOR);
        assert(account.allowedTokens(CELO_USDC));
        assert(account.allowedTokens(CELO_USDT));
        assert(account.allowedTokens(CELO_USDM));
        assert(account.allowedRouteTargets(ROUTE_TARGET));
    }

    function testDefaultAllowedTokensAreCeloStablecoins() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory tokens = deployer.defaultAllowedTokens();

        assert(tokens.length == 3);
        assert(tokens[0] == CELO_USDC);
        assert(tokens[1] == CELO_USDT);
        assert(tokens[2] == CELO_USDM);
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
}
