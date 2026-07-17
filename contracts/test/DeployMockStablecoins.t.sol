// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../script/DeployMockStablecoins.s.sol";

contract DeployMockStablecoinsTest {
    address private constant OWNER = address(0x1234);

    function testDeploysCeloDevelopmentMockStablecoins() public {
        DeployMockStablecoins deployer = new DeployMockStablecoins();

        (MockStablecoin usdc, MockStablecoin usdt, MockStablecoin usdm) = deployer.deploy(OWNER);

        assert(keccak256(bytes(usdc.name())) == keccak256(bytes("Mock USDC")));
        assert(keccak256(bytes(usdc.symbol())) == keccak256(bytes("USDC")));
        assert(usdc.decimals() == 6);
        assert(usdc.owner() == OWNER);

        assert(keccak256(bytes(usdt.name())) == keccak256(bytes("Mock USDT")));
        assert(keccak256(bytes(usdt.symbol())) == keccak256(bytes("USDT")));
        assert(usdt.decimals() == 6);
        assert(usdt.owner() == OWNER);

        assert(keccak256(bytes(usdm.name())) == keccak256(bytes("Mock USDm")));
        assert(keccak256(bytes(usdm.symbol())) == keccak256(bytes("USDm")));
        assert(usdm.decimals() == 18);
        assert(usdm.owner() == OWNER);
    }
}
