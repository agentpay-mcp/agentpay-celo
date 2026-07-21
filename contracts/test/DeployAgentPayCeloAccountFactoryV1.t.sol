// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPayCeloAccountFactoryV1} from "../src/AgentPayCeloAccountFactoryV1.sol";
import {DeployAgentPayCeloAccountFactoryV1} from "../script/DeployAgentPayCeloAccountFactoryV1.s.sol";

interface VmCeloFactoryDeployTest {
    function chainId(uint256 newChainId) external;
}

contract DeployAgentPayCeloAccountFactoryV1Test {
    VmCeloFactoryDeployTest private constant vm =
        VmCeloFactoryDeployTest(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant EXECUTOR = address(0xE11E);
    address private constant CELO_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    function testDeploysPinnedFactoryOnlyOnCeloMainnet() public {
        vm.chainId(42220);
        DeployAgentPayCeloAccountFactoryV1 deployer = new DeployAgentPayCeloAccountFactoryV1();

        AgentPayCeloAccountFactoryV1 factory = deployer.deploy(EXECUTOR);

        assert(factory.executor() == EXECUTOR);
        assert(factory.CELO_CHAIN_ID() == 42220);
        assert(factory.USDC() == CELO_USDC);
        assert(factory.POLICY_VERSION() == keccak256("agentpay-celo-mainnet-account-v1"));
    }

    function testRejectsCeloSepoliaAndOtherChains() public {
        DeployAgentPayCeloAccountFactoryV1 deployer = new DeployAgentPayCeloAccountFactoryV1();

        vm.chainId(11142220);
        assert(_deployReverts(deployer));

        vm.chainId(1);
        assert(_deployReverts(deployer));
    }

    function _deployReverts(DeployAgentPayCeloAccountFactoryV1 deployer) private returns (bool) {
        try deployer.deploy(EXECUTOR) returns (AgentPayCeloAccountFactoryV1) {
            return false;
        } catch {
            return true;
        }
    }
}
