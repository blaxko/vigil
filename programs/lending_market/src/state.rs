use anchor_lang::prelude::*;

#[account]
pub struct Reserve {
    /// Collateral token mint (AAPLx, Token-2022 with scaled-ui-amount).
    pub collateral_mint: Pubkey,
    /// Vault token account (owned by this Reserve's PDA authority) holding
    /// all deposited collateral for this isolated market.
    pub collateral_vault: Pubkey,
    /// Debt token mint (USDC or a devnet mock, plain SPL Token).
    pub debt_mint: Pubkey,
    /// Vault token account holding USDC available to lend out.
    pub debt_vault: Pubkey,
    /// The `regime_oracle::RegimeState` PDA this reserve prices against.
    /// Enforced isolation: one market, one collateral asset, one oracle.
    pub regime_state: Pubkey,

    /// Max loan-to-value against the Borrow-Limit Price, in bps.
    pub max_ltv_bps: u16,
    /// Debt/collateral ratio (against the Liquidation Price) at or above
    /// which a position becomes liquidation-eligible, in bps.
    pub liquidation_threshold_bps: u16,
    /// Discount a liquidator receives off the Liquidation Price, in bps
    /// (flat-discount liquidation only -- no Dutch auction for MVP).
    pub liquidation_bonus_bps: u16,
    /// Minimum seconds a position must hold a borrow before collateral can
    /// be withdrawn or the debt increased again -- closes the
    /// latency-arbitrage window at the open/close regime boundary.
    pub min_hold_time_secs: i64,

    pub total_collateral_base: u64,
    pub total_debt: u64,

    pub authority_bump: u8,
    pub bump: u8,
}

impl Reserve {
    pub const SEED_PREFIX: &'static [u8] = b"reserve";
    pub const AUTHORITY_SEED_PREFIX: &'static [u8] = b"reserve_authority";

    pub const SIZE: usize = 8 // discriminator
        + 32 // collateral_mint
        + 32 // collateral_vault
        + 32 // debt_mint
        + 32 // debt_vault
        + 32 // regime_state
        + 2  // max_ltv_bps
        + 2  // liquidation_threshold_bps
        + 2  // liquidation_bonus_bps
        + 8  // min_hold_time_secs
        + 8  // total_collateral_base
        + 8  // total_debt
        + 1  // authority_bump
        + 1; // bump
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub reserve: Pubkey,
    /// Collateral held, in the mint's *base* units (never display/UI
    /// units) -- Token-2022 scaled-ui-amount conversion happens only at
    /// the point value is computed, never stored.
    pub collateral_base: u64,
    /// Outstanding USDC debt (6-decimal base units). No interest accrual
    /// in the MVP (out of scope; see brief section 6).
    pub debt_amount: u64,
    /// Unix timestamp of the most recent borrow against this position.
    pub last_borrow_ts: i64,
    pub bump: u8,
}

impl Position {
    pub const SEED_PREFIX: &'static [u8] = b"position";

    pub const SIZE: usize = 8 // discriminator
        + 32 // owner
        + 32 // reserve
        + 8  // collateral_base
        + 8  // debt_amount
        + 8  // last_borrow_ts
        + 1; // bump
}
