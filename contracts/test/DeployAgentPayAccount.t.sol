// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../script/DeployAgentPayAccount.s.sol";
import "../src/AgentPayAccount.sol";

contract DeployAgentPayAccountTest {
    address private constant OWNER = address(0x1234);
    address private constant EXECUTOR = address(0x5678);
    address private constant ROUTE_TARGET = address(0x7777);
    address private constant XLAYER_USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address private constant XLAYER_USDC = 0x74b7F16337b8972027F6196A17a631aC6dE26d22;
    address private constant XLAYER_TESTNET_USDT0 = 0x9e29b3AaDa05Bf2D2c827Af80Bd28Dc0b9b4FB0c;
    address private constant XLAYER_TESTNET_USDC = 0xcB8BF24c6cE16Ad21D707c9505421a17f2bec79D;

    function testDeploysAccountWithDefaultStableTokenAllowlist() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory routeTargets = new address[](1);
        routeTargets[0] = ROUTE_TARGET;

        AgentPayAccount account = deployer.deploy(OWNER, EXECUTOR, routeTargets);

        assert(account.owner() == OWNER);
        assert(account.executor() == EXECUTOR);
        assert(account.allowedTokens(XLAYER_USDT0));
        assert(account.allowedTokens(XLAYER_USDC));
        assert(account.allowedRouteTargets(ROUTE_TARGET));
    }

    function testDefaultAllowedTokensAreXLayerStablecoins() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory tokens = deployer.defaultAllowedTokens();

        assert(tokens.length == 2);
        assert(tokens[0] == XLAYER_USDT0);
        assert(tokens[1] == XLAYER_USDC);
    }

    function testDefaultAllowedTokensSupportXLayerTestnetStablecoins() public {
        DeployAgentPayAccount deployer = new DeployAgentPayAccount();
        address[] memory tokens = deployer.defaultAllowedTokensForChain(1952);

        assert(deployer.XLAYER_TESTNET_USDT0() == XLAYER_TESTNET_USDT0);
        assert(deployer.XLAYER_TESTNET_USDC() == XLAYER_TESTNET_USDC);
        assert(tokens.length == 2);
        assert(tokens[0] != address(0));
        assert(tokens[1] != address(0));
        assert(tokens[0] != tokens[1]);
    }
}
