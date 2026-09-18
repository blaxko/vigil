use anchor_lang::prelude::*;

pub mod errors;
pub mod health;
pub mod instructions;
pub mod oracle;
pub mod state;
pub mod token2022;

use instructions::*;

declare_id!("nKD282jg8NPnVLv5hhPrRk8XRfkan8xj73KP6fNTK5K");

#[program]
pub mod lending_market {
    use super::*;

    /// One isolated market PDA per collateral mint (AAPLx only for MVP).
    pub fn initialize_reserve(
        ctx: Context<InitializeReserve>,
        max_ltv_bps: u16,
        liquidation_threshold_bps: u16,
        liquidation_bonus_bps: u16,
        min_hold_time_secs: i64,
    ) -> Result<()> {
        instructions::initialize_reserve::handler(
            ctx,
            max_ltv_bps,
            liquidation_threshold_bps,
            liquidation_bonus_bps,
            min_hold_time_secs,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, amount_base: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount_base)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount_base: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount_base)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        instructions::borrow::handler(ctx, amount)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::handler(ctx, amount)
    }

    /// Permissionless: checked against the Liquidation Price with a
    /// staleness guard. Full-position liquidation only (MVP scope).
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidate::handler(ctx)
    }
}
