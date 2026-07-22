// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPayAccountV2} from "./AgentPayAccountV2.sol";

/// @title AgentPayCeloAccountFactoryV1
/// @notice Deterministically deploys owner-authorized AgentPayAccountV2 instances on Celo mainnet.
contract AgentPayCeloAccountFactoryV1 {
    struct MainnetWalletSetup {
        string setupIntentId;
        bytes32 deploymentNonce;
        address owner;
        address executor;
        uint256 homeChainId;
        string environment;
        uint256 deadline;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        bytes32 deploymentSalt;
        address predictedAccount;
        bytes32 accountCreationCodeHash;
        bytes32 accountRuntimeCodeHash;
        address token;
        bytes32 tokenAllowlistHash;
        bytes32 routeAllowlistHash;
        bytes32 manifestSha256;
    }

    error UnsupportedChain(uint256 chainId);
    error ZeroExecutor();
    error ZeroOwner();
    error OwnerMustBeEOA(address owner);
    error OwnerCannotBeExecutor();
    error OwnerCannotBeFactory();
    error InvalidSetupIntentIdLength(uint256 length);
    error AuthorizationExpired(uint256 deadline);
    error InvalidHomeChainId(uint256 chainId);
    error InvalidEnvironment();
    error ExecutorMismatch();
    error FactoryMismatch();
    error FactoryRuntimeCodeHashMismatch();
    error DeploymentSaltMismatch();
    error PredictedAccountMismatch();
    error AccountCreationCodeHashMismatch();
    error AccountRuntimeCodeHashMismatch();
    error TokenMismatch();
    error TokenAllowlistHashMismatch();
    error RouteAllowlistHashMismatch();
    error InvalidSignatureLength(uint256 length);
    error InvalidSignatureV(uint8 v);
    error InvalidSignatureS();
    error InvalidOwnerSignature();
    error ReusedAccountPolicyMismatch();
    error UnexpectedAccountAddress(address expected, address actual);

    event AccountDeployed(
        address indexed owner, address indexed account, bytes32 indexed salt, bytes32 authorizationHash
    );
    event AccountReused(address indexed owner, address indexed account, bytes32 indexed authorizationHash);

    uint256 public constant CELO_CHAIN_ID = 42220;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    bytes32 public constant POLICY_VERSION = keccak256("agentpay-celo-mainnet-account-v1");
    bytes32 public constant TOKEN_ALLOWLIST_HASH = 0xcbb6c89bb5bf981f61dac2e79e732d017d0aefcdb843f6202c5960618184fe67;
    bytes32 public constant ROUTE_ALLOWLIST_HASH = 0x569e75fc77c1a856f6daaf9e69d8a9566ca34aa47f9133711ce065a571af0cfd;

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _MAINNET_WALLET_SETUP_TYPEHASH = keccak256(
        "MainnetWalletSetup(string setupIntentId,bytes32 deploymentNonce,address owner,address executor,uint256 homeChainId,string environment,uint256 deadline,address factory,bytes32 factoryRuntimeCodeHash,bytes32 deploymentSalt,address predictedAccount,bytes32 accountCreationCodeHash,bytes32 accountRuntimeCodeHash,address token,bytes32 tokenAllowlistHash,bytes32 routeAllowlistHash,bytes32 manifestSha256)"
    );
    bytes32 private constant _NAME_HASH = keccak256("AgentPay Setup");
    bytes32 private constant _VERSION_HASH = keccak256("1");
    bytes32 private constant _PRODUCTION_HASH = keccak256("production");
    bytes4 private constant _OWNER_SELECTOR = bytes4(keccak256("owner()"));
    bytes4 private constant _EXECUTOR_SELECTOR = bytes4(keccak256("executor()"));
    bytes4 private constant _PAUSED_SELECTOR = bytes4(keccak256("paused()"));
    bytes4 private constant _ALLOWED_TOKENS_SELECTOR = bytes4(keccak256("allowedTokens(address)"));
    uint256 private constant _SECP256K1_N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable executor;

    constructor(address initialExecutor) {
        if (block.chainid != CELO_CHAIN_ID) revert UnsupportedChain(block.chainid);
        if (initialExecutor == address(0)) revert ZeroExecutor();
        executor = initialExecutor;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_EIP712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, CELO_CHAIN_ID, address(this)));
    }

    function hashSetupAuthorization(MainnetWalletSetup calldata authorization) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), _setupAuthorizationStructHash(authorization)));
    }

    function deploymentSalt(address owner) public view returns (bytes32) {
        _validateOwner(owner);
        return _deploymentSalt(owner);
    }

    function accountCreationCodeHash() public pure returns (bytes32) {
        return keccak256(type(AgentPayAccountV2).creationCode);
    }

    function accountInitCodeHash(address owner) public view returns (bytes32) {
        _validateOwner(owner);
        return _accountInitCodeHash(owner);
    }

    function predictAccount(address owner) public view returns (address) {
        _validateOwner(owner);
        return _predictAccount(owner);
    }

    function deployAccount(MainnetWalletSetup calldata authorization, bytes calldata ownerSignature)
        external
        returns (address account)
    {
        _validateAuthorizationPolicy(authorization);
        bytes32 authorizationHash = hashSetupAuthorization(authorization);
        _verifyOwnerSignature(authorization.owner, authorizationHash, ownerSignature);

        address predicted = authorization.predictedAccount;
        if (predicted.code.length != 0) {
            _validateRuntimeCodeHash(predicted, authorization.accountRuntimeCodeHash);
            _validateReusedAccount(predicted, authorization.owner);
            emit AccountReused(authorization.owner, predicted, authorizationHash);
            return predicted;
        }

        (address[] memory tokens, address[] memory routeTargets) = _initialPolicy();
        account = address(
            new AgentPayAccountV2{salt: authorization.deploymentSalt}(
                authorization.owner, executor, tokens, routeTargets
            )
        );
        if (account != predicted) revert UnexpectedAccountAddress(predicted, account);
        _validateRuntimeCodeHash(account, authorization.accountRuntimeCodeHash);

        emit AccountDeployed(authorization.owner, account, authorization.deploymentSalt, authorizationHash);
    }

    function _validateAuthorizationPolicy(MainnetWalletSetup calldata authorization) private view {
        _validateOwner(authorization.owner);

        uint256 setupIntentIdLength = bytes(authorization.setupIntentId).length;
        if (setupIntentIdLength < 16 || setupIntentIdLength > 128) {
            revert InvalidSetupIntentIdLength(setupIntentIdLength);
        }
        if (authorization.deadline <= block.timestamp) revert AuthorizationExpired(authorization.deadline);
        if (authorization.homeChainId != CELO_CHAIN_ID) {
            revert InvalidHomeChainId(authorization.homeChainId);
        }
        if (keccak256(bytes(authorization.environment)) != _PRODUCTION_HASH) revert InvalidEnvironment();
        if (authorization.executor != executor) revert ExecutorMismatch();
        if (authorization.factory != address(this)) revert FactoryMismatch();
        if (authorization.factoryRuntimeCodeHash != address(this).codehash) {
            revert FactoryRuntimeCodeHashMismatch();
        }
        if (authorization.deploymentSalt != _deploymentSalt(authorization.owner)) {
            revert DeploymentSaltMismatch();
        }
        if (authorization.predictedAccount != _predictAccount(authorization.owner)) {
            revert PredictedAccountMismatch();
        }
        if (authorization.accountCreationCodeHash != accountCreationCodeHash()) {
            revert AccountCreationCodeHashMismatch();
        }
        if (authorization.token != USDC) revert TokenMismatch();
        if (authorization.tokenAllowlistHash != TOKEN_ALLOWLIST_HASH) revert TokenAllowlistHashMismatch();
        if (authorization.routeAllowlistHash != ROUTE_ALLOWLIST_HASH) revert RouteAllowlistHashMismatch();
    }

    function _setupAuthorizationStructHash(MainnetWalletSetup calldata authorization) private pure returns (bytes32) {
        bytes32[18] memory words;
        words[0] = _MAINNET_WALLET_SETUP_TYPEHASH;
        words[1] = keccak256(bytes(authorization.setupIntentId));
        words[2] = authorization.deploymentNonce;
        words[3] = bytes32(uint256(uint160(authorization.owner)));
        words[4] = bytes32(uint256(uint160(authorization.executor)));
        words[5] = bytes32(authorization.homeChainId);
        words[6] = keccak256(bytes(authorization.environment));
        words[7] = bytes32(authorization.deadline);
        words[8] = bytes32(uint256(uint160(authorization.factory)));
        words[9] = authorization.factoryRuntimeCodeHash;
        words[10] = authorization.deploymentSalt;
        words[11] = bytes32(uint256(uint160(authorization.predictedAccount)));
        words[12] = authorization.accountCreationCodeHash;
        words[13] = authorization.accountRuntimeCodeHash;
        words[14] = bytes32(uint256(uint160(authorization.token)));
        words[15] = authorization.tokenAllowlistHash;
        words[16] = authorization.routeAllowlistHash;
        words[17] = authorization.manifestSha256;
        return keccak256(abi.encode(words));
    }

    function _verifyOwnerSignature(address owner, bytes32 authorizationHash, bytes calldata ownerSignature)
        private
        pure
    {
        if (ownerSignature.length != 65) revert InvalidSignatureLength(ownerSignature.length);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(ownerSignature.offset)
            s := calldataload(add(ownerSignature.offset, 32))
            v := byte(0, calldataload(add(ownerSignature.offset, 64)))
        }

        if (v != 27 && v != 28) revert InvalidSignatureV(v);
        if (uint256(s) > _SECP256K1_N_HALF) revert InvalidSignatureS();
        address recovered = ecrecover(authorizationHash, v, r, s);
        if (recovered == address(0) || recovered != owner) revert InvalidOwnerSignature();
    }

    function _validateRuntimeCodeHash(address account, bytes32 expectedRuntimeCodeHash) private view {
        if (account.codehash != expectedRuntimeCodeHash) revert AccountRuntimeCodeHashMismatch();
    }

    function _validateReusedAccount(address account, address expectedOwner) private view {
        if (
            address(uint160(uint256(_readStaticWord(account, abi.encodeWithSelector(_OWNER_SELECTOR)))))
                    != expectedOwner
                || address(uint160(uint256(_readStaticWord(account, abi.encodeWithSelector(_EXECUTOR_SELECTOR)))))
                    != executor || uint256(_readStaticWord(account, abi.encodeWithSelector(_PAUSED_SELECTOR))) != 0
                || uint256(_readStaticWord(account, abi.encodeWithSelector(_ALLOWED_TOKENS_SELECTOR, USDC))) != 1
        ) {
            revert ReusedAccountPolicyMismatch();
        }
    }

    function _readStaticWord(address account, bytes memory callData) private view returns (bytes32 value) {
        (bool success, bytes memory returnData) = account.staticcall(callData);
        if (!success || returnData.length != 32) revert ReusedAccountPolicyMismatch();
        assembly {
            value := mload(add(returnData, 32))
        }
    }

    function _accountInitCodeHash(address owner) private view returns (bytes32) {
        (address[] memory tokens, address[] memory routeTargets) = _initialPolicy();
        return keccak256(
            abi.encodePacked(type(AgentPayAccountV2).creationCode, abi.encode(owner, executor, tokens, routeTargets))
        );
    }

    function _initialPolicy() private pure returns (address[] memory tokens, address[] memory routeTargets) {
        tokens = new address[](1);
        tokens[0] = USDC;
        routeTargets = new address[](0);
    }

    function _deploymentSalt(address owner) private pure returns (bytes32) {
        return keccak256(abi.encode(POLICY_VERSION, owner));
    }

    function _predictAccount(address owner) private view returns (address) {
        bytes32 digest = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _deploymentSalt(owner), _accountInitCodeHash(owner))
        );
        return address(uint160(uint256(digest)));
    }

    function _validateOwner(address owner) private view {
        if (owner == address(0)) revert ZeroOwner();
        if (owner == executor) revert OwnerCannotBeExecutor();
        if (owner == address(this)) revert OwnerCannotBeFactory();
        if (owner.code.length != 0) revert OwnerMustBeEOA(owner);
    }
}
