// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPayAccountV2} from "../src/AgentPayAccountV2.sol";
import {AgentPayCeloAccountFactoryV1} from "../src/AgentPayCeloAccountFactoryV1.sol";

interface VmCeloFactory {
    function addr(uint256 privateKey) external returns (address);
    function assume(bool condition) external;
    function chainId(uint256 newChainId) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract AgentPayCeloAccountFactoryV1Test {
    VmCeloFactory private constant vm = VmCeloFactory(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant OWNER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant OTHER_PRIVATE_KEY = 0xB0B;
    address private constant EXECUTOR = address(0xE11E);
    address private constant CELO_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    address private owner;
    AgentPayCeloAccountFactoryV1 private factory;
    bytes32 private accountRuntimeCodeHash;

    function setUp() public {
        vm.chainId(42220);
        owner = vm.addr(OWNER_PRIVATE_KEY);
        factory = new AgentPayCeloAccountFactoryV1(EXECUTOR);
        accountRuntimeCodeHash = _runtimeCodeHash(owner);
    }

    function testDeploysDeterministicOwnerAuthorizedCeloAccount() public {
        AgentPayCeloAccountFactoryV1.MainnetWalletSetup memory authorization = _authorization();
        bytes memory signature = _sign(OWNER_PRIVATE_KEY, factory.hashSetupAuthorization(authorization));

        address accountAddress = factory.deployAccount(authorization, signature);
        AgentPayAccountV2 account = AgentPayAccountV2(payable(accountAddress));

        assert(accountAddress == authorization.predictedAccount);
        assert(account.owner() == owner);
        assert(account.executor() == EXECUTOR);
        assert(account.allowedTokens(CELO_USDC));
        assert(!account.allowedRouteTargets(address(0xCAFE)));
    }

    function testRepeatedAuthorizationReusesTheSameVerifiedAccount() public {
        AgentPayCeloAccountFactoryV1.MainnetWalletSetup memory authorization = _authorization();
        bytes memory signature = _sign(OWNER_PRIVATE_KEY, factory.hashSetupAuthorization(authorization));

        address first = factory.deployAccount(authorization, signature);
        address second = factory.deployAccount(authorization, signature);

        assert(first == second);
        assert(first == factory.predictAccount(owner));
    }

    function testRejectsWrongSignatureExpiredAuthorizationAndPolicyMutation() public {
        AgentPayCeloAccountFactoryV1.MainnetWalletSetup memory authorization = _authorization();
        bytes memory signature = _sign(OTHER_PRIVATE_KEY, factory.hashSetupAuthorization(authorization));

        vm.expectRevert(AgentPayCeloAccountFactoryV1.InvalidOwnerSignature.selector);
        factory.deployAccount(authorization, signature);

        authorization.deadline = block.timestamp;
        signature = _sign(OWNER_PRIVATE_KEY, factory.hashSetupAuthorization(authorization));
        vm.expectRevert(
            abi.encodeWithSelector(AgentPayCeloAccountFactoryV1.AuthorizationExpired.selector, block.timestamp)
        );
        factory.deployAccount(authorization, signature);

        authorization = _authorization();
        authorization.token = address(0xBAD);
        signature = _sign(OWNER_PRIVATE_KEY, factory.hashSetupAuthorization(authorization));
        vm.expectRevert(AgentPayCeloAccountFactoryV1.TokenMismatch.selector);
        factory.deployAccount(authorization, signature);
    }

    function testRejectsWrongRuntimeHashWithoutLeavingAnAccountDeployed() public {
        AgentPayCeloAccountFactoryV1.MainnetWalletSetup memory authorization = _authorization();
        address predicted = authorization.predictedAccount;
        authorization.accountRuntimeCodeHash = keccak256("wrong-runtime");
        bytes memory signature = _sign(OWNER_PRIVATE_KEY, factory.hashSetupAuthorization(authorization));

        vm.expectRevert(AgentPayCeloAccountFactoryV1.AccountRuntimeCodeHashMismatch.selector);
        factory.deployAccount(authorization, signature);

        assert(predicted.code.length == 0);
    }

    function testConstructorFailsClosedOutsideCeloMainnet() public {
        vm.chainId(11142220);
        vm.expectRevert(
            abi.encodeWithSelector(AgentPayCeloAccountFactoryV1.UnsupportedChain.selector, uint256(11142220))
        );
        new AgentPayCeloAccountFactoryV1(EXECUTOR);
    }

    function testFactoryPinsCeloPolicyAndCreate2Inputs() public view {
        address[] memory tokens = new address[](1);
        tokens[0] = CELO_USDC;
        address[] memory routes = new address[](0);

        assert(factory.CELO_CHAIN_ID() == 42220);
        assert(factory.USDC() == CELO_USDC);
        assert(factory.TOKEN_ALLOWLIST_HASH() == keccak256(abi.encode(tokens)));
        assert(factory.ROUTE_ALLOWLIST_HASH() == keccak256(abi.encode(routes)));
        assert(factory.accountCreationCodeHash() == keccak256(type(AgentPayAccountV2).creationCode));
        assert(
            factory.accountInitCodeHash(owner)
                == keccak256(
                    abi.encodePacked(type(AgentPayAccountV2).creationCode, abi.encode(owner, EXECUTOR, tokens, routes))
                )
        );
    }

    function testFuzzPredictionIsDeterministicForValidEoaOwners(address candidateOwner) public {
        vm.assume(candidateOwner != address(0));
        vm.assume(candidateOwner != EXECUTOR);
        vm.assume(candidateOwner != address(factory));
        vm.assume(candidateOwner.code.length == 0);

        address first = factory.predictAccount(candidateOwner);
        address second = factory.predictAccount(candidateOwner);

        assert(first == second);
        assert(first != address(0));
    }

    function _authorization()
        private
        view
        returns (AgentPayCeloAccountFactoryV1.MainnetWalletSetup memory authorization)
    {
        authorization = AgentPayCeloAccountFactoryV1.MainnetWalletSetup({
            setupIntentId: "setup-intent-celo-0001",
            deploymentNonce: keccak256("deployment-nonce"),
            owner: owner,
            executor: EXECUTOR,
            homeChainId: 42220,
            environment: "production",
            deadline: block.timestamp + 1 hours,
            factory: address(factory),
            factoryRuntimeCodeHash: address(factory).codehash,
            deploymentSalt: factory.deploymentSalt(owner),
            predictedAccount: factory.predictAccount(owner),
            accountCreationCodeHash: factory.accountCreationCodeHash(),
            accountRuntimeCodeHash: accountRuntimeCodeHash,
            token: CELO_USDC,
            tokenAllowlistHash: factory.TOKEN_ALLOWLIST_HASH(),
            routeAllowlistHash: factory.ROUTE_ALLOWLIST_HASH(),
            manifestSha256: keccak256("manifest")
        });
    }

    function _runtimeCodeHash(address accountOwner) private returns (bytes32) {
        address[] memory tokens = new address[](1);
        tokens[0] = CELO_USDC;
        AgentPayAccountV2 referenceAccount = new AgentPayAccountV2(accountOwner, EXECUTOR, tokens, new address[](0));
        return address(referenceAccount).codehash;
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
