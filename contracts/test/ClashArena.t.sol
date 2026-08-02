// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClashArena} from "../src/ClashArena.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {ReentrantERC20} from "./mocks/ReentrantERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract ClashArenaTest is Test {
    ClashArena internal arena;
    MockERC20 internal usdm;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal settler = makeAddr("settler");

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");

    uint256 internal constant ENTRY = 1e18; // 1 USDm
    uint64 internal startTime;
    uint64 internal endTime;

    function setUp() public {
        vm.warp(1_800_000_000);

        usdm = new MockERC20("Celo Dollar", "USDm", 18);
        arena = new ClashArena(treasury, settler, owner);

        startTime = uint64(block.timestamp);
        endTime = startTime + 1 hours;

        address[4] memory funded = [alice, bob, carol, mallory];
        for (uint256 i = 0; i < funded.length; ++i) {
            usdm.mint(funded[i], 1_000e18);
            vm.prank(funded[i]);
            usdm.approve(address(arena), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _createTournament() internal returns (uint256 id) {
        vm.prank(settler);
        id = arena.createTournament(startTime, endTime, address(usdm), ENTRY);
    }

    function _join(uint256 id, address who) internal {
        vm.prank(who);
        arena.join(id);
    }

    function _arr(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function _arr(address a, address b) internal pure returns (address[] memory out) {
        out = new address[](2);
        out[0] = a;
        out[1] = b;
    }

    function _arr(address a, address b, address c) internal pure returns (address[] memory out) {
        out = new address[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    function _w(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function _w(uint256 a, uint256 b) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        out[0] = a;
        out[1] = b;
    }

    function _w(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory out) {
        out = new uint256[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    // ------------------------------------------------------------------
    // Construction & admin
    // ------------------------------------------------------------------

    function test_Constructor_SetsInitialState() public view {
        assertEq(arena.treasury(), treasury);
        assertEq(arena.settler(), settler);
        assertEq(arena.owner(), owner);
        assertEq(arena.rakeBps(), 800, "default rake is 8%");
        assertEq(arena.nextTournamentId(), 1, "ids are 1-based");
        assertEq(arena.nextDuelId(), 1);
    }

    function test_Constructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(ClashArena.ZeroAddress.selector);
        new ClashArena(address(0), settler, owner);
    }

    function test_Constructor_RevertsOnZeroSettler() public {
        vm.expectRevert(ClashArena.ZeroAddress.selector);
        new ClashArena(treasury, address(0), owner);
    }

    function test_SetTreasury() public {
        address next = makeAddr("nextTreasury");
        vm.prank(owner);
        arena.setTreasury(next);
        assertEq(arena.treasury(), next);
    }

    function test_SetTreasury_RevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        arena.setTreasury(mallory);
    }

    function test_SetTreasury_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(ClashArena.ZeroAddress.selector);
        arena.setTreasury(address(0));
    }

    function test_SetSettler() public {
        address next = makeAddr("nextSettler");
        vm.prank(owner);
        arena.setSettler(next);
        assertEq(arena.settler(), next);
    }

    function test_SetSettler_RevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        arena.setSettler(mallory);
    }

    function test_SetRakeBps() public {
        vm.prank(owner);
        arena.setRakeBps(500);
        assertEq(arena.rakeBps(), 500);
    }

    function test_SetRakeBps_RevertsAboveCap() public {
        vm.prank(owner);
        vm.expectRevert(ClashArena.RakeTooHigh.selector);
        arena.setRakeBps(1_001);
    }

    function test_SetRakeBps_AllowsExactlyCap() public {
        vm.prank(owner);
        arena.setRakeBps(1_000);
        assertEq(arena.rakeBps(), 1_000, "10% is the ceiling, inclusive");
    }

    function test_SetRakeBps_RevertsForNonOwner() public {
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, settler));
        arena.setRakeBps(0);
    }

    // ------------------------------------------------------------------
    // createTournament
    // ------------------------------------------------------------------

    function test_CreateTournament() public {
        uint256 id = _createTournament();
        assertEq(id, 1);

        (
            address entryToken,
            uint256 entryAmount,
            uint64 start,
            uint64 end,
            uint256 totalPot,
            bool settled,
            uint256 players
        ) = arena.getTournament(id);

        assertEq(entryToken, address(usdm));
        assertEq(entryAmount, ENTRY);
        assertEq(start, startTime);
        assertEq(end, endTime);
        assertEq(totalPot, 0);
        assertFalse(settled);
        assertEq(players, 0);
        assertEq(arena.tournamentIdForStart(startTime), id);
    }

    function test_CreateTournament_OwnerMayAlsoCreate() public {
        vm.prank(owner);
        uint256 id = arena.createTournament(startTime, endTime, address(usdm), ENTRY);
        assertEq(id, 1);
    }

    function test_CreateTournament_RevertsForStranger() public {
        vm.prank(mallory);
        vm.expectRevert(ClashArena.NotSettler.selector);
        arena.createTournament(startTime, endTime, address(usdm), ENTRY);
    }

    function test_CreateTournament_RevertsOnDuplicateStartTime() public {
        _createTournament();
        vm.prank(settler);
        vm.expectRevert(ClashArena.TournamentExists.selector);
        arena.createTournament(startTime, endTime + 1, address(usdm), ENTRY);
    }

    function test_CreateTournament_RevertsOnInvertedWindow() public {
        vm.prank(settler);
        vm.expectRevert(ClashArena.InvalidWindow.selector);
        arena.createTournament(endTime, startTime, address(usdm), ENTRY);
    }

    function test_CreateTournament_RevertsOnZeroEntry() public {
        vm.prank(settler);
        vm.expectRevert(ClashArena.InvalidAmount.selector);
        arena.createTournament(startTime, endTime, address(usdm), 0);
    }

    function test_CreateTournament_RevertsOnZeroToken() public {
        vm.prank(settler);
        vm.expectRevert(ClashArena.ZeroAddress.selector);
        arena.createTournament(startTime, endTime, address(0), ENTRY);
    }

    // ------------------------------------------------------------------
    // join
    // ------------------------------------------------------------------

    function test_Join_HappyPath() public {
        uint256 id = _createTournament();

        vm.expectEmit(true, true, false, true, address(arena));
        emit ClashArena.PlayerJoined(id, alice, ENTRY);
        _join(id, alice);

        (,,,, uint256 totalPot,, uint256 players) = arena.getTournament(id);
        assertEq(totalPot, ENTRY);
        assertEq(players, 1);
        assertTrue(arena.hasJoined(id, alice));
        assertEq(usdm.balanceOf(address(arena)), ENTRY, "entry is escrowed in the arena");
        assertEq(usdm.balanceOf(alice), 1_000e18 - ENTRY);
        assertEq(arena.getPlayers(id)[0], alice);
    }

    function test_Join_AccumulatesPot() public {
        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        _join(id, carol);

        (,,,, uint256 totalPot,, uint256 players) = arena.getTournament(id);
        assertEq(totalPot, 3 * ENTRY);
        assertEq(players, 3);
        assertEq(usdm.balanceOf(address(arena)), 3 * ENTRY);
    }

    function test_Join_RevertsOnDoubleJoin() public {
        uint256 id = _createTournament();
        _join(id, alice);

        vm.prank(alice);
        vm.expectRevert(ClashArena.AlreadyJoined.selector);
        arena.join(id);
    }

    function test_Join_RevertsAfterEndTime() public {
        uint256 id = _createTournament();
        vm.warp(endTime);

        vm.prank(alice);
        vm.expectRevert(ClashArena.TournamentClosed.selector);
        arena.join(id);
    }

    function test_Join_RevertsBeforeStartTime() public {
        vm.prank(settler);
        uint256 id = arena.createTournament(block.timestamp + 1 hours, block.timestamp + 2 hours, address(usdm), ENTRY);

        vm.prank(alice);
        vm.expectRevert(ClashArena.NotStarted.selector);
        arena.join(id);
    }

    function test_Join_RevertsForUnknownTournament() public {
        vm.prank(alice);
        vm.expectRevert(ClashArena.UnknownTournament.selector);
        arena.join(999);
    }

    function test_Join_RevertsWithoutApproval() public {
        uint256 id = _createTournament();
        address broke = makeAddr("broke");
        usdm.mint(broke, ENTRY);

        vm.prank(broke);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(arena), 0, ENTRY)
        );
        arena.join(id);
    }

    // ------------------------------------------------------------------
    // settle
    // ------------------------------------------------------------------

    function test_Settle_DistributesPotAndTakesRake() public {
        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        _join(id, carol);
        vm.warp(endTime);

        uint256 pot = 3 * ENTRY;
        uint256 expectedRake = (pot * 800) / 10_000; // 0.24 USDm
        uint256 distributable = pot - expectedRake; // 2.76 USDm

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore = usdm.balanceOf(bob);
        uint256 carolBefore = usdm.balanceOf(carol);

        vm.expectEmit(true, false, false, true, address(arena));
        emit ClashArena.FeeCollected(address(usdm), expectedRake);

        vm.prank(settler);
        arena.settle(id, _arr(alice, bob, carol), _w(3, 2, 1));

        assertEq(usdm.balanceOf(treasury), expectedRake, "treasury receives the 8% rake");
        assertEq(usdm.balanceOf(alice) - aliceBefore, (distributable * 3) / 6);
        assertEq(usdm.balanceOf(bob) - bobBefore, (distributable * 2) / 6);
        assertEq(usdm.balanceOf(carol) - carolBefore, (distributable * 1) / 6);
        assertEq(usdm.balanceOf(address(arena)), 0, "pot is fully drained");

        (,,,,, bool settled,) = arena.getTournament(id);
        assertTrue(settled);
    }

    function test_Settle_SingleWinnerTakesAll() public {
        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        vm.warp(endTime);

        uint256 pot = 2 * ENTRY;
        uint256 rake = (pot * 800) / 10_000;

        vm.prank(settler);
        arena.settle(id, _arr(alice), _w(1));

        assertEq(usdm.balanceOf(treasury), rake);
        assertEq(usdm.balanceOf(alice), 1_000e18 - ENTRY + (pot - rake));
        assertEq(usdm.balanceOf(address(arena)), 0);
    }

    function test_Settle_RoundingDustGoesToTopWinner() public {
        // Entry of 7 wei over 3 players gives a pot of 21: rake floors to 1, leaving 20 to split
        // three ways. 20/3 = 6 each, so 2 wei of dust must land on the top-weighted winner.
        vm.prank(settler);
        uint256 id = arena.createTournament(startTime, endTime, address(usdm), 7);
        _join(id, alice);
        _join(id, bob);
        _join(id, carol);
        vm.warp(endTime);

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore = usdm.balanceOf(bob);
        uint256 carolBefore = usdm.balanceOf(carol);

        vm.prank(settler);
        arena.settle(id, _arr(alice, bob, carol), _w(1, 1, 1));

        assertEq(usdm.balanceOf(treasury), 1, "rake floors to 1 wei");
        assertEq(usdm.balanceOf(alice) - aliceBefore, 8, "6 + 2 wei of dust");
        assertEq(usdm.balanceOf(bob) - bobBefore, 6);
        assertEq(usdm.balanceOf(carol) - carolBefore, 6);
        assertEq(usdm.balanceOf(address(arena)), 0, "no residue is left behind");
    }

    function test_Settle_ZeroRakeDistributesWholePot() public {
        vm.prank(owner);
        arena.setRakeBps(0);

        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        vm.warp(endTime);

        vm.prank(settler);
        arena.settle(id, _arr(alice), _w(1));

        assertEq(usdm.balanceOf(treasury), 0);
        assertEq(usdm.balanceOf(alice), 1_000e18 - ENTRY + 2 * ENTRY);
    }

    function test_Settle_EmptyTournamentIsANoOp() public {
        uint256 id = _createTournament();
        vm.warp(endTime);

        address[] memory noWinners = new address[](0);
        uint256[] memory noWeights = new uint256[](0);

        vm.prank(settler);
        arena.settle(id, noWinners, noWeights);

        (,,,,, bool settled,) = arena.getTournament(id);
        assertTrue(settled, "an empty hour still closes so the scheduler does not wedge");
        assertEq(usdm.balanceOf(treasury), 0);
    }

    function test_Settle_RevertsBeforeEndTime() public {
        uint256 id = _createTournament();
        _join(id, alice);

        vm.prank(settler);
        vm.expectRevert(ClashArena.TournamentOpen.selector);
        arena.settle(id, _arr(alice), _w(1));
    }

    function test_Settle_RevertsForNonSettler() public {
        uint256 id = _createTournament();
        _join(id, alice);
        vm.warp(endTime);

        vm.prank(owner); // even the owner cannot settle
        vm.expectRevert(ClashArena.NotSettler.selector);
        arena.settle(id, _arr(alice), _w(1));

        vm.prank(mallory);
        vm.expectRevert(ClashArena.NotSettler.selector);
        arena.settle(id, _arr(mallory), _w(1));
    }

    function test_Settle_RevertsOnDoubleSettle() public {
        uint256 id = _createTournament();
        _join(id, alice);
        vm.warp(endTime);

        vm.prank(settler);
        arena.settle(id, _arr(alice), _w(1));

        vm.prank(settler);
        vm.expectRevert(ClashArena.AlreadySettled.selector);
        arena.settle(id, _arr(alice), _w(1));
    }

    function test_Settle_RevertsWhenWinnerNeverJoined() public {
        uint256 id = _createTournament();
        _join(id, alice);
        vm.warp(endTime);

        vm.prank(settler);
        vm.expectRevert(ClashArena.NotAPlayer.selector);
        arena.settle(id, _arr(mallory), _w(1));
    }

    function test_Settle_RevertsOnLengthMismatch() public {
        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        vm.warp(endTime);

        vm.prank(settler);
        vm.expectRevert(ClashArena.LengthMismatch.selector);
        arena.settle(id, _arr(alice, bob), _w(1));
    }

    function test_Settle_RevertsOnNoWinnersForANonEmptyPot() public {
        uint256 id = _createTournament();
        _join(id, alice);
        vm.warp(endTime);

        address[] memory noWinners = new address[](0);
        uint256[] memory noWeights = new uint256[](0);

        vm.prank(settler);
        vm.expectRevert(ClashArena.NoWinners.selector);
        arena.settle(id, noWinners, noWeights);
    }

    function test_Settle_RevertsOnAllZeroWeights() public {
        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        vm.warp(endTime);

        vm.prank(settler);
        vm.expectRevert(ClashArena.ZeroWeight.selector);
        arena.settle(id, _arr(alice, bob), _w(0, 0));
    }

    function test_Settle_RevertsForUnknownTournament() public {
        vm.prank(settler);
        vm.expectRevert(ClashArena.UnknownTournament.selector);
        arena.settle(42, _arr(alice), _w(1));
    }

    function test_Settle_RevertsOnReentrantToken() public {
        ReentrantERC20 evil = new ReentrantERC20();
        evil.mint(alice, 100e18);
        vm.prank(alice);
        evil.approve(address(arena), type(uint256).max);

        vm.prank(settler);
        uint256 id = arena.createTournament(startTime, endTime, address(evil), ENTRY);
        _join(id, alice);
        evil.arm(arena, id);
        vm.warp(endTime);

        vm.prank(settler);
        vm.expectRevert();
        arena.settle(id, _arr(alice), _w(1));
    }

    // ------------------------------------------------------------------
    // Duels
    // ------------------------------------------------------------------

    function test_Duel_FullFlow() public {
        uint256 stake = 5e18;

        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), stake);
        assertEq(duelId, 1);
        assertEq(usdm.balanceOf(address(arena)), stake, "creator stake is escrowed immediately");

        vm.prank(bob);
        arena.acceptDuel(duelId);
        assertEq(usdm.balanceOf(address(arena)), 2 * stake);

        (address creator, address opponent,, uint256 storedStake, ClashArena.DuelStatus status, uint64 acceptedAt) =
            arena.getDuel(duelId);
        assertEq(creator, alice);
        assertEq(opponent, bob);
        assertEq(storedStake, stake);
        assertEq(uint8(status), uint8(ClashArena.DuelStatus.Accepted));
        assertEq(acceptedAt, uint64(block.timestamp), "the acceptance clock starts here");

        uint256 pot = 2 * stake;
        uint256 rake = (pot * 800) / 10_000;

        vm.prank(settler);
        arena.settleDuel(duelId, bob);

        assertEq(usdm.balanceOf(treasury), rake);
        assertEq(usdm.balanceOf(bob), 1_000e18 - stake + (pot - rake));
        assertEq(usdm.balanceOf(alice), 1_000e18 - stake);
        assertEq(usdm.balanceOf(address(arena)), 0);

        (,,,, ClashArena.DuelStatus finalStatus,) = arena.getDuel(duelId);
        assertEq(uint8(finalStatus), uint8(ClashArena.DuelStatus.Settled));
    }

    function test_Duel_CreateRevertsOnZeroStake() public {
        vm.prank(alice);
        vm.expectRevert(ClashArena.InvalidAmount.selector);
        arena.createDuel(address(usdm), 0);
    }

    function test_Duel_CreateRevertsOnZeroToken() public {
        vm.prank(alice);
        vm.expectRevert(ClashArena.ZeroAddress.selector);
        arena.createDuel(address(0), 1e18);
    }

    function test_Duel_CannotAcceptOwnDuel() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);

        vm.prank(alice);
        vm.expectRevert(ClashArena.CannotDuelSelf.selector);
        arena.acceptDuel(duelId);
    }

    function test_Duel_CannotAcceptTwice() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(carol);
        vm.expectRevert(ClashArena.DuelNotOpen.selector);
        arena.acceptDuel(duelId);
    }

    function test_Duel_AcceptRevertsForUnknownDuel() public {
        vm.prank(bob);
        vm.expectRevert(ClashArena.UnknownDuel.selector);
        arena.acceptDuel(77);
    }

    function test_Duel_CancelRefundsCreator() public {
        uint256 stake = 3e18;
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), stake);

        vm.prank(alice);
        arena.cancelDuel(duelId);

        assertEq(usdm.balanceOf(alice), 1_000e18, "stake is returned in full");
        assertEq(usdm.balanceOf(address(arena)), 0);

        (,,,, ClashArena.DuelStatus status,) = arena.getDuel(duelId);
        assertEq(uint8(status), uint8(ClashArena.DuelStatus.Cancelled));
    }

    function test_Duel_CancelRevertsForStranger() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);

        vm.prank(mallory);
        vm.expectRevert(ClashArena.NotDuelCreator.selector);
        arena.cancelDuel(duelId);
    }

    function test_Duel_CancelRevertsOnceAccepted() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(alice);
        vm.expectRevert(ClashArena.DuelNotOpen.selector);
        arena.cancelDuel(duelId);
    }

    function test_Duel_SettleRevertsForNonSettler() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(alice);
        vm.expectRevert(ClashArena.NotSettler.selector);
        arena.settleDuel(duelId, alice);
    }

    function test_Duel_SettleRevertsForOutsider() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(settler);
        vm.expectRevert(ClashArena.NotADuelist.selector);
        arena.settleDuel(duelId, mallory);
    }

    function test_Duel_SettleRevertsBeforeAccept() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);

        vm.prank(settler);
        vm.expectRevert(ClashArena.DuelNotAccepted.selector);
        arena.settleDuel(duelId, alice);
    }

    function test_Duel_SettleRevertsTwice() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(settler);
        arena.settleDuel(duelId, alice);

        vm.prank(settler);
        vm.expectRevert(ClashArena.DuelNotAccepted.selector);
        arena.settleDuel(duelId, alice);
    }

    // ------------------------------------------------------------------
    // Voiding a duel neither player completed
    // ------------------------------------------------------------------

    function test_Duel_VoidRefundsBothSides() public {
        uint256 stake = 4e18;

        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), stake);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.expectEmit(true, true, true, true, address(arena));
        emit ClashArena.DuelVoided(duelId, alice, bob, stake);

        vm.prank(settler);
        arena.voidDuel(duelId);

        assertEq(usdm.balanceOf(alice), 1_000e18, "creator made whole");
        assertEq(usdm.balanceOf(bob), 1_000e18, "opponent made whole");
        assertEq(usdm.balanceOf(treasury), 0, "no rake on a contest that never happened");
        assertEq(usdm.balanceOf(address(arena)), 0);

        (,,,, ClashArena.DuelStatus status,) = arena.getDuel(duelId);
        assertEq(uint8(status), uint8(ClashArena.DuelStatus.Cancelled));
    }

    function test_Duel_VoidRevertsForNonSettler() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(alice);
        vm.expectRevert(ClashArena.NotSettler.selector);
        arena.voidDuel(duelId);
    }

    function test_Duel_VoidRevertsBeforeAccept() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);

        vm.prank(settler);
        vm.expectRevert(ClashArena.DuelNotAccepted.selector);
        arena.voidDuel(duelId);
    }

    function test_Duel_VoidRevertsAfterSettlement() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(settler);
        arena.settleDuel(duelId, alice);

        vm.prank(settler);
        vm.expectRevert(ClashArena.DuelNotAccepted.selector);
        arena.voidDuel(duelId);
    }

    function test_Duel_VoidRevertsForUnknownDuel() public {
        vm.prank(settler);
        vm.expectRevert(ClashArena.UnknownDuel.selector);
        arena.voidDuel(404);
    }

    function test_Duel_CannotSettleAfterVoid() public {
        vm.prank(alice);
        uint256 duelId = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(duelId);

        vm.prank(settler);
        arena.voidDuel(duelId);

        vm.prank(settler);
        vm.expectRevert(ClashArena.DuelNotAccepted.selector);
        arena.settleDuel(duelId, alice);
    }

    /// @dev Every accepted duel must have exactly one terminal path out, and both drain the escrow.
    function test_Duel_EveryAcceptedDuelCanBeResolved() public {
        vm.prank(alice);
        uint256 settled = arena.createDuel(address(usdm), 1e18);
        vm.prank(bob);
        arena.acceptDuel(settled);

        vm.prank(alice);
        uint256 voided = arena.createDuel(address(usdm), 1e18);
        vm.prank(carol);
        arena.acceptDuel(voided);

        vm.startPrank(settler);
        arena.settleDuel(settled, bob);
        arena.voidDuel(voided);
        vm.stopPrank();

        assertEq(usdm.balanceOf(address(arena)), 0, "no duel escrow is ever left behind");
    }

    // ------------------------------------------------------------------
    // Six-decimal token (USDC / USDT shape)
    // ------------------------------------------------------------------

    function test_Settle_WorksWithSixDecimalToken() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        uint256 entry = 250_000; // 0.25 USDC

        address[2] memory players = [alice, bob];
        for (uint256 i = 0; i < players.length; ++i) {
            usdc.mint(players[i], 100e6);
            vm.prank(players[i]);
            usdc.approve(address(arena), type(uint256).max);
        }

        vm.prank(settler);
        uint256 id = arena.createTournament(startTime, endTime, address(usdc), entry);
        _join(id, alice);
        _join(id, bob);
        vm.warp(endTime);

        uint256 pot = 2 * entry;
        uint256 rake = (pot * 800) / 10_000;

        vm.prank(settler);
        arena.settle(id, _arr(alice), _w(1));

        assertEq(usdc.balanceOf(treasury), rake);
        assertEq(usdc.balanceOf(alice), 100e6 - entry + (pot - rake));
        assertEq(usdc.balanceOf(address(arena)), 0);
    }

    // ------------------------------------------------------------------
    // Fuzz / invariant-style checks
    // ------------------------------------------------------------------

    /// @dev Whatever the weights, the pot must be fully conserved: rake + payouts == pot, and the
    ///      arena must retain nothing.
    function testFuzz_Settle_ConservesThePot(uint96 wA, uint96 wB, uint96 wC, uint16 rake) public {
        vm.assume(uint256(wA) + uint256(wB) + uint256(wC) > 0);
        rake = uint16(bound(rake, 0, 1_000));

        vm.prank(owner);
        arena.setRakeBps(rake);

        uint256 id = _createTournament();
        _join(id, alice);
        _join(id, bob);
        _join(id, carol);
        vm.warp(endTime);

        uint256 pot = 3 * ENTRY;
        uint256 before = usdm.balanceOf(alice) + usdm.balanceOf(bob) + usdm.balanceOf(carol);

        vm.prank(settler);
        arena.settle(id, _arr(alice, bob, carol), _w(wA, wB, wC));

        uint256 paidToPlayers = usdm.balanceOf(alice) + usdm.balanceOf(bob) + usdm.balanceOf(carol) - before;
        assertEq(paidToPlayers + usdm.balanceOf(treasury), pot, "rake + payouts == pot");
        assertEq(usdm.balanceOf(address(arena)), 0, "arena retains nothing");
    }

    /// @dev The rake can never exceed the cap, whatever the pot size.
    function testFuzz_Settle_RakeNeverExceedsCap(uint96 entryAmount) public {
        entryAmount = uint96(bound(entryAmount, 1, 100e18));

        vm.prank(owner);
        arena.setRakeBps(1_000);

        vm.prank(settler);
        uint256 id = arena.createTournament(startTime, endTime, address(usdm), entryAmount);
        _join(id, alice);
        _join(id, bob);
        vm.warp(endTime);

        uint256 pot = 2 * uint256(entryAmount);

        vm.prank(settler);
        arena.settle(id, _arr(alice), _w(1));

        assertLe(usdm.balanceOf(treasury) * 10_000, pot * 1_000, "rake is at most 10% of the pot");
    }
}
