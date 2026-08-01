// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClashArena} from "../src/ClashArena.sol";

/// @notice Opens a single tournament by hand — used for the testnet create → join → settle
///         smoke test before the hourly cron is wired up.
///
/// Required env:
///   SETTLER_PRIVATE_KEY, CLASH_ADDRESS, ENTRY_TOKEN, ENTRY_AMOUNT
/// Optional env:
///   DURATION_SECONDS (default 3600)
contract OpenTournament is Script {
    function run() external {
        uint256 settlerKey = vm.envUint("SETTLER_PRIVATE_KEY");
        ClashArena arena = ClashArena(vm.envAddress("CLASH_ADDRESS"));
        address entryToken = vm.envAddress("ENTRY_TOKEN");
        uint256 entryAmount = vm.envUint("ENTRY_AMOUNT");
        uint256 duration = vm.envOr("DURATION_SECONDS", uint256(3600));

        uint256 start = block.timestamp;
        uint256 end = start + duration;

        vm.startBroadcast(settlerKey);
        uint256 id = arena.createTournament(start, end, entryToken, entryAmount);
        vm.stopBroadcast();

        console.log("tournament id  ", id);
        console.log("  start        ", start);
        console.log("  end          ", end);
        console.log("  entry token  ", entryToken);
        console.log("  entry amount ", entryAmount);
    }
}
