// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClashArena} from "../src/ClashArena.sol";

/// @notice Deploys ClashArena to Celo Sepolia (11142220) or Celo mainnet (42220).
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY  — funded with a little CELO on the target chain
///   TREASURY_ADDRESS      — receives the rake (use the Safe on mainnet)
///   SETTLER_ADDRESS       — operator key allowed to settle
/// Optional env:
///   OWNER_ADDRESS         — admin owner; defaults to TREASURY_ADDRESS
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url celo_sepolia --broadcast --verify
///   forge script script/Deploy.s.sol:Deploy --rpc-url celo       --broadcast --verify
contract Deploy is Script {
    function run() external returns (ClashArena arena) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address settler = vm.envAddress("SETTLER_ADDRESS");
        address owner = vm.envOr("OWNER_ADDRESS", treasury);

        require(treasury != address(0), "TREASURY_ADDRESS unset");
        require(settler != address(0), "SETTLER_ADDRESS unset");

        vm.startBroadcast(deployerKey);
        arena = new ClashArena(treasury, settler, owner);
        vm.stopBroadcast();

        console.log("chain id       ", block.chainid);
        console.log("ClashArena     ", address(arena));
        console.log("  treasury     ", treasury);
        console.log("  settler      ", settler);
        console.log("  owner        ", owner);
        console.log("  rakeBps      ", arena.rakeBps());
        console.log("");
        console.log("Set NEXT_PUBLIC_CLASH_ADDRESS to the ClashArena address above.");
    }
}
