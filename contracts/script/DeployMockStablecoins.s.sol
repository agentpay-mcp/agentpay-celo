// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/MockStablecoin.sol";

interface MockStablecoinVm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMockStablecoins {
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

    MockStablecoinVm internal constant vm = MockStablecoinVm(VM_ADDRESS);

    event MockStablecoinsDeployed(address indexed usdc, address indexed usdt, address indexed usdm, address owner);

    function run() external returns (MockStablecoin usdc, MockStablecoin usdt, MockStablecoin usdm) {
        uint256 deployerPrivateKey = vm.envUint("SETUP_DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("AGENTPAY_OWNER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        (usdc, usdt, usdm) = deploy(owner);
        vm.stopBroadcast();
    }

    function deploy(address owner) public returns (MockStablecoin usdc, MockStablecoin usdt, MockStablecoin usdm) {
        usdc = new MockStablecoin("Mock USDC", "USDC", 6, owner);
        usdt = new MockStablecoin("Mock USDT", "USDT", 6, owner);
        usdm = new MockStablecoin("Mock USDm", "USDm", 18, owner);

        emit MockStablecoinsDeployed(address(usdc), address(usdt), address(usdm), owner);
    }
}
