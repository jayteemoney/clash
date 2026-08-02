// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ClashArena
/// @notice Escrow and settlement for Clash — a skill-based tournament arena on Celo.
///         Players pay a stablecoin entry into an hourly tournament. Every player in a
///         tournament plays the *same* deterministic board (the game seed is derived from the
///         tournament id), so placement is a function of skill, not chance. After the tournament
///         window closes, an operator ("settler") ranks the submitted scores and calls
///         {settle}, which takes a rake for the treasury and splits the remainder pro-rata
///         among the winners.
///
///         Also supports 1v1 duels: both sides stake the same amount, the winner takes the pot
///         minus the same rake.
///
/// @dev    Players never sign a message — entering is an ERC-20 `approve` followed by a plain
///         contract call. This is a hard MiniPay requirement (`personal_sign` and
///         `eth_signTypedData` are unsupported there).
///
///         Settlement in this version is **operator-attested**: games run client-side and the
///         settler backend ranks the scores it receives. The contract constrains the operator in
///         the ways that matter for custody — it can only pay addresses that actually joined, it
///         can never pay out more than the pot, it can never exceed the rake cap, and it can
///         never withdraw the escrow to itself. It cannot, however, be stopped from ranking
///         dishonestly. See the README for the path to trustless scoring.
contract ClashArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Tournament {
        address entryToken;
        uint256 entryAmount;
        uint64 startTime;
        uint64 endTime;
        uint256 totalPot;
        bool settled;
        address[] players;
    }

    enum DuelStatus {
        None,
        Open,
        Accepted,
        Settled,
        Cancelled
    }

    struct Duel {
        address creator;
        address opponent;
        address entryToken;
        uint256 stake;
        DuelStatus status;
        /// @dev When the opponent accepted. Starts the clock the settler measures the duel
        ///      deadline against — without it there is no on-chain way to tell a duel still in
        ///      play from one both players abandoned.
        uint64 acceptedAt;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Denominator for basis-point maths.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard ceiling on the rake. The owner can never set a rake above 10%.
    uint256 public constant MAX_RAKE_BPS = 1_000;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Address that receives the rake.
    address public treasury;

    /// @notice Operator permitted to settle tournaments and duels.
    address public settler;

    /// @notice Rake taken from each settled pot, in basis points. Defaults to 800 (8%).
    uint256 public rakeBps = 800;

    /// @dev Ids are 1-based so that 0 can be used as "does not exist".
    uint256 public nextTournamentId = 1;
    uint256 public nextDuelId = 1;

    mapping(uint256 tournamentId => Tournament) private _tournaments;
    mapping(uint256 tournamentId => mapping(address player => bool)) public hasJoined;

    /// @notice Lookup from a tournament start timestamp to its id. Keeps the hourly scheduler
    ///         idempotent: a retried cron run cannot create a duplicate tournament for the same
    ///         hour. 0 means "no tournament for this start time".
    mapping(uint64 startTime => uint256 tournamentId) public tournamentIdForStart;

    mapping(uint256 duelId => Duel) private _duels;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event TournamentCreated(
        uint256 indexed tournamentId, address indexed entryToken, uint256 entryAmount, uint64 startTime, uint64 endTime
    );
    event PlayerJoined(uint256 indexed tournamentId, address indexed player, uint256 amount);
    event TournamentSettled(uint256 indexed tournamentId, uint256 totalPot, uint256 rake, uint256 winnerCount);
    event Payout(uint256 indexed tournamentId, address indexed winner, uint256 amount);
    event FeeCollected(address indexed entryToken, uint256 rake);

    event DuelCreated(uint256 indexed duelId, address indexed creator, address indexed entryToken, uint256 stake);
    event DuelAccepted(uint256 indexed duelId, address indexed opponent, uint64 acceptedAt);
    event DuelCancelled(uint256 indexed duelId);
    event DuelSettled(uint256 indexed duelId, address indexed winner, uint256 amount, uint256 rake);
    event DuelVoided(uint256 indexed duelId, address indexed creator, address indexed opponent, uint256 stake);

    event TreasuryUpdated(address indexed treasury);
    event SettlerUpdated(address indexed settler);
    event RakeBpsUpdated(uint256 rakeBps);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidWindow();
    error InvalidAmount();
    error TournamentExists();
    error UnknownTournament();
    error NotStarted();
    error TournamentClosed();
    error TournamentOpen();
    error AlreadyJoined();
    error AlreadySettled();
    error NotSettler();
    error LengthMismatch();
    error NoWinners();
    error ZeroWeight();
    error NotAPlayer();
    error RakeTooHigh();
    error UnknownDuel();
    error DuelNotOpen();
    error DuelNotAccepted();
    error CannotDuelSelf();
    error NotDuelCreator();
    error NotADuelist();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlySettler() {
        if (msg.sender != settler) revert NotSettler();
        _;
    }

    /// @dev The scheduler runs as the settler, but the owner can always open a tournament by hand.
    modifier onlyOperator() {
        if (msg.sender != settler && msg.sender != owner()) revert NotSettler();
        _;
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(address treasury_, address settler_, address owner_) Ownable(owner_) {
        if (treasury_ == address(0) || settler_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        settler = settler_;
        emit TreasuryUpdated(treasury_);
        emit SettlerUpdated(settler_);
    }

    // ---------------------------------------------------------------------
    // Tournaments
    // ---------------------------------------------------------------------

    /// @notice Open a tournament. The game board every player sees is derived from the returned id.
    /// @param startTime Unix timestamp at which entries open.
    /// @param endTime   Unix timestamp after which entries close and settlement becomes possible.
    /// @param entryToken ERC-20 stablecoin used for entry (USDm / USDC / USDT).
    /// @param entryAmount Entry price, in `entryToken` base units.
    function createTournament(uint256 startTime, uint256 endTime, address entryToken, uint256 entryAmount)
        external
        onlyOperator
        returns (uint256 tournamentId)
    {
        if (entryToken == address(0)) revert ZeroAddress();
        if (entryAmount == 0) revert InvalidAmount();
        if (endTime <= startTime) revert InvalidWindow();
        if (startTime > type(uint64).max || endTime > type(uint64).max) revert InvalidWindow();

        // Both casts are guarded by the type(uint64).max bounds check above, so neither truncates.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 start = uint64(startTime);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 end = uint64(endTime);

        if (tournamentIdForStart[start] != 0) revert TournamentExists();

        tournamentId = nextTournamentId++;

        Tournament storage t = _tournaments[tournamentId];
        t.entryToken = entryToken;
        t.entryAmount = entryAmount;
        t.startTime = start;
        t.endTime = end;

        tournamentIdForStart[start] = tournamentId;

        emit TournamentCreated(tournamentId, entryToken, entryAmount, start, end);
    }

    /// @notice Enter a tournament. Pulls the entry price from the caller — the frontend performs
    ///         the ERC-20 `approve` first. No signature is ever requested from the player.
    function join(uint256 tournamentId) external nonReentrant {
        Tournament storage t = _tournaments[tournamentId];
        if (t.entryToken == address(0)) revert UnknownTournament();
        // Tournament windows are an hour wide, so the few seconds a sequencer could nudge
        // block.timestamp by cannot meaningfully change who is allowed in.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < t.startTime) revert NotStarted();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= t.endTime) revert TournamentClosed();
        if (t.settled) revert AlreadySettled();
        if (hasJoined[tournamentId][msg.sender]) revert AlreadyJoined();

        hasJoined[tournamentId][msg.sender] = true;
        t.players.push(msg.sender);
        t.totalPot += t.entryAmount;

        IERC20(t.entryToken).safeTransferFrom(msg.sender, address(this), t.entryAmount);

        emit PlayerJoined(tournamentId, msg.sender, t.entryAmount);
    }

    /// @notice Rank the tournament and pay out. Operator-only, and only after the window closes.
    /// @param winners Addresses to pay. Every one must have joined this tournament.
    /// @param weights Relative shares, same length as `winners`. Pro-rata over the sum.
    /// @dev Rounding dust from the pro-rata division is added to the first winner's payout so the
    ///      pot is always fully distributed and no residue accumulates in the contract.
    function settle(uint256 tournamentId, address[] calldata winners, uint256[] calldata weights)
        external
        onlySettler
        nonReentrant
    {
        Tournament storage t = _tournaments[tournamentId];
        if (t.entryToken == address(0)) revert UnknownTournament();
        // Same reasoning as in {join}: an hour-wide window is far outside any timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < t.endTime) revert TournamentOpen();
        if (t.settled) revert AlreadySettled();
        if (winners.length != weights.length) revert LengthMismatch();

        // Effects before interactions.
        t.settled = true;

        uint256 pot = t.totalPot;
        address token = t.entryToken;

        // A tournament nobody entered settles to a no-op rather than reverting, so the scheduler
        // does not get wedged on an empty hour.
        if (pot == 0) {
            emit TournamentSettled(tournamentId, 0, 0, 0);
            return;
        }

        if (winners.length == 0) revert NoWinners();

        uint256 totalWeight;
        for (uint256 i = 0; i < weights.length; ++i) {
            if (!hasJoined[tournamentId][winners[i]]) revert NotAPlayer();
            totalWeight += weights[i];
        }
        if (totalWeight == 0) revert ZeroWeight();

        uint256 rake = (pot * rakeBps) / BPS_DENOMINATOR;
        uint256 distributable = pot - rake;

        uint256[] memory amounts = new uint256[](winners.length);
        uint256 assigned;
        for (uint256 i = 0; i < winners.length; ++i) {
            uint256 amount = (distributable * weights[i]) / totalWeight;
            amounts[i] = amount;
            assigned += amount;
        }
        // Hand the rounding dust to the top-weighted entry.
        amounts[0] += distributable - assigned;

        emit TournamentSettled(tournamentId, pot, rake, winners.length);

        if (rake > 0) {
            IERC20(token).safeTransfer(treasury, rake);
            emit FeeCollected(token, rake);
        }

        for (uint256 i = 0; i < winners.length; ++i) {
            if (amounts[i] == 0) continue;
            IERC20(token).safeTransfer(winners[i], amounts[i]);
            emit Payout(tournamentId, winners[i], amounts[i]);
        }
    }

    // ---------------------------------------------------------------------
    // Duels
    // ---------------------------------------------------------------------

    /// @notice Open a 1v1 duel and escrow the creator's stake. Share the returned id as an invite.
    function createDuel(address entryToken, uint256 stake) external nonReentrant returns (uint256 duelId) {
        if (entryToken == address(0)) revert ZeroAddress();
        if (stake == 0) revert InvalidAmount();

        duelId = nextDuelId++;
        _duels[duelId] = Duel({
            creator: msg.sender,
            opponent: address(0),
            entryToken: entryToken,
            stake: stake,
            status: DuelStatus.Open,
            acceptedAt: 0
        });

        IERC20(entryToken).safeTransferFrom(msg.sender, address(this), stake);

        emit DuelCreated(duelId, msg.sender, entryToken, stake);
    }

    /// @notice Accept an open duel, matching the creator's stake.
    function acceptDuel(uint256 duelId) external nonReentrant {
        Duel storage d = _duels[duelId];
        if (d.status == DuelStatus.None) revert UnknownDuel();
        if (d.status != DuelStatus.Open) revert DuelNotOpen();
        if (d.creator == msg.sender) revert CannotDuelSelf();

        d.opponent = msg.sender;
        d.status = DuelStatus.Accepted;
        // forge-lint: disable-next-line(unsafe-typecast)
        d.acceptedAt = uint64(block.timestamp);

        IERC20(d.entryToken).safeTransferFrom(msg.sender, address(this), d.stake);

        emit DuelAccepted(duelId, msg.sender, d.acceptedAt);
    }

    /// @notice Withdraw an unaccepted duel and refund the creator.
    /// @dev Without this, a stake sitting in an invite nobody accepts would be stranded forever.
    function cancelDuel(uint256 duelId) external nonReentrant {
        Duel storage d = _duels[duelId];
        if (d.status == DuelStatus.None) revert UnknownDuel();
        if (d.status != DuelStatus.Open) revert DuelNotOpen();
        if (d.creator != msg.sender) revert NotDuelCreator();

        d.status = DuelStatus.Cancelled;

        IERC20(d.entryToken).safeTransfer(d.creator, d.stake);

        emit DuelCancelled(duelId);
    }

    /// @notice Pay out an accepted duel. Operator-only. `winner` must be one of the two duelists.
    function settleDuel(uint256 duelId, address winner) external onlySettler nonReentrant {
        Duel storage d = _duels[duelId];
        if (d.status == DuelStatus.None) revert UnknownDuel();
        if (d.status != DuelStatus.Accepted) revert DuelNotAccepted();
        if (winner != d.creator && winner != d.opponent) revert NotADuelist();

        d.status = DuelStatus.Settled;

        uint256 pot = d.stake * 2;
        uint256 rake = (pot * rakeBps) / BPS_DENOMINATOR;
        uint256 payout = pot - rake;
        address token = d.entryToken;

        if (rake > 0) {
            IERC20(token).safeTransfer(treasury, rake);
            emit FeeCollected(token, rake);
        }
        IERC20(token).safeTransfer(winner, payout);

        emit DuelSettled(duelId, winner, payout, rake);
    }

    /// @notice Refund both sides of an accepted duel that neither player completed.
    /// @dev The counterpart to {settleDuel}: that function must name a winner, so on its own it
    ///      cannot resolve a duel where nobody played. Without this the two stakes would sit in the
    ///      contract permanently, since {cancelDuel} only applies while a duel is still Open.
    ///      No rake is taken — there was no contest to take a cut of.
    function voidDuel(uint256 duelId) external onlySettler nonReentrant {
        Duel storage d = _duels[duelId];
        if (d.status == DuelStatus.None) revert UnknownDuel();
        if (d.status != DuelStatus.Accepted) revert DuelNotAccepted();

        d.status = DuelStatus.Cancelled;

        IERC20(d.entryToken).safeTransfer(d.creator, d.stake);
        IERC20(d.entryToken).safeTransfer(d.opponent, d.stake);

        emit DuelVoided(duelId, d.creator, d.opponent, d.stake);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setSettler(address settler_) external onlyOwner {
        if (settler_ == address(0)) revert ZeroAddress();
        settler = settler_;
        emit SettlerUpdated(settler_);
    }

    function setRakeBps(uint256 rakeBps_) external onlyOwner {
        if (rakeBps_ > MAX_RAKE_BPS) revert RakeTooHigh();
        rakeBps = rakeBps_;
        emit RakeBpsUpdated(rakeBps_);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTournament(uint256 tournamentId)
        external
        view
        returns (
            address entryToken,
            uint256 entryAmount,
            uint64 startTime,
            uint64 endTime,
            uint256 totalPot,
            bool settled,
            uint256 numPlayers
        )
    {
        Tournament storage t = _tournaments[tournamentId];
        return (t.entryToken, t.entryAmount, t.startTime, t.endTime, t.totalPot, t.settled, t.players.length);
    }

    function getPlayers(uint256 tournamentId) external view returns (address[] memory) {
        return _tournaments[tournamentId].players;
    }

    function playerCount(uint256 tournamentId) external view returns (uint256) {
        return _tournaments[tournamentId].players.length;
    }

    function getDuel(uint256 duelId)
        external
        view
        returns (
            address creator,
            address opponent,
            address entryToken,
            uint256 stake,
            DuelStatus status,
            uint64 acceptedAt
        )
    {
        Duel storage d = _duels[duelId];
        return (d.creator, d.opponent, d.entryToken, d.stake, d.status, d.acceptedAt);
    }
}
