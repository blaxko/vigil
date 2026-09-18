use anchor_lang::prelude::*;

#[account]
pub struct RegimeState {
    /// Keeper authority allowed to call `set_regime` and `post_dex_reference`.
    pub keeper_authority: Pubkey,
    /// The program that must own the account passed as `update_price`'s
    /// `price_update`. Set once at `initialize` (production: Pyth's real
    /// Solana Receiver program, same address on every cluster; local/devnet
    /// testing: a lightweight mock price-setter program, so tests can
    /// exercise the open-market path deterministically without depending
    /// on Hermes). The staleness bound and feed-id check inside
    /// `update_price` are identical either way -- only the trusted account
    /// origin differs, the same kind of documented substitution as the
    /// devnet mock-USDC mint.
    pub pyth_receiver_program: Pubkey,
    /// The Pyth `PriceUpdateV2` feed id this instance tracks (e.g. AAPLx/USD).
    pub price_feed_id: [u8; 32],
    /// True while the underlying market (NYSE hours) is open.
    pub is_open: bool,
    /// Unix timestamp of the most recent `is_open` transition.
    pub last_regime_change_ts: i64,
    /// True only for the single tick immediately following a Closed->Open
    /// transition, so `update_price` knows to apply the wider reopen clamp
    /// instead of the normal per-tick clamp.
    pub pending_reopen_snap: bool,

    /// Last live Pyth price observed while the market was open -- the
    /// "anchor" the decay function blends away from during closure.
    pub anchor_price: u64,
    /// Unix timestamp `anchor_price` was captured at.
    pub anchor_ts: i64,

    /// Most recent keeper-posted DEX TWAP reference price (micro-USD).
    pub dex_reference_price: u64,
    /// Most recent keeper-posted DEX pool liquidity depth (micro-USD),
    /// used to dampen the DEX reference's influence on the closed blend.
    pub dex_reference_liquidity: u128,
    /// Unix timestamp the DEX reference was last posted.
    pub dex_reference_ts: i64,

    /// Slow-smoothed, conservative price the lending market uses to compute
    /// borrow limits.
    pub borrow_limit_price: u64,
    /// Fast-smoothed, wider-banded price the lending market uses to check
    /// liquidation eligibility.
    pub liquidation_price: u64,
    /// Unix timestamp the two output prices were last updated.
    pub last_update_ts: i64,

    pub bump: u8,
}

impl RegimeState {
    pub const SEED_PREFIX: &'static [u8] = b"regime_state";

    pub const SIZE: usize = 8 // discriminator
        + 32 // keeper_authority
        + 32 // pyth_receiver_program
        + 32 // price_feed_id
        + 1  // is_open
        + 8  // last_regime_change_ts
        + 1  // pending_reopen_snap
        + 8  // anchor_price
        + 8  // anchor_ts
        + 8  // dex_reference_price
        + 16 // dex_reference_liquidity (u128)
        + 8  // dex_reference_ts
        + 8  // borrow_limit_price
        + 8  // liquidation_price
        + 8  // last_update_ts
        + 1; // bump
}
