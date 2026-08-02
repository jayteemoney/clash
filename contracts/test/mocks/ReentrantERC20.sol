// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ClashArena} from "../../src/ClashArena.sol";

/// @dev A hostile token that tries to re-enter {ClashArena.settle} from inside `transfer`.
///      Used to prove the ReentrancyGuard + checks-effects-interactions ordering holds.
contract ReentrantERC20 is ERC20 {
    ClashArena public arena;
    uint256 public targetTournamentId;
    bool private _attacking;

    constructor() ERC20("Reentrant", "RE") {}

    function arm(ClashArena arena_, uint256 tournamentId_) external {
        arena = arena_;
        targetTournamentId = tournamentId_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (address(arena) != address(0) && !_attacking && from == address(arena)) {
            _attacking = true;
            address[] memory winners = new address[](1);
            uint256[] memory weights = new uint256[](1);
            winners[0] = to;
            weights[0] = 1;
            // Expected to revert — the outer settle bubbles it up.
            arena.settle(targetTournamentId, winners, weights);
            _attacking = false;
        }
    }
}
