use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::Reserve;

#[derive(Accounts)]
pub struct InitializeReserve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub collateral_mint: InterfaceAccount<'info, Mint>,
    pub debt_mint: InterfaceAccount<'info, Mint>,

    /// The `regime_oracle::RegimeState` PDA this reserve will price
    /// against. Stored by reference only -- not deserialized here, no CPI
    /// needed to record it.
    /// CHECK: address recorded verbatim; every price-dependent instruction
    /// re-derives and validates this PDA's seeds against the recorded key.
    pub regime_state: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = Reserve::SIZE,
        seeds = [Reserve::SEED_PREFIX, collateral_mint.key().as_ref()],
        bump,
    )]
    pub reserve: Account<'info, Reserve>,

    /// CHECK: PDA used only as a token-account authority; never read from.
    #[account(
        seeds = [Reserve::AUTHORITY_SEED_PREFIX, reserve.key().as_ref()],
        bump,
    )]
    pub reserve_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        token::mint = collateral_mint,
        token::authority = reserve_authority,
        token::token_program = collateral_token_program,
        seeds = [b"collateral_vault", reserve.key().as_ref()],
        bump,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        token::mint = debt_mint,
        token::authority = reserve_authority,
        token::token_program = debt_token_program,
        seeds = [b"debt_vault", reserve.key().as_ref()],
        bump,
    )]
    pub debt_vault: InterfaceAccount<'info, TokenAccount>,

    /// Collateral (e.g. Token-2022 AAPLx) and debt (e.g. legacy-Token USDC)
    /// mints can be owned by different token programs; this instruction
    /// creates a vault for each, so -- like `liquidate` -- it needs two
    /// separate token-program references rather than one shared one.
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub debt_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeReserve>,
    max_ltv_bps: u16,
    liquidation_threshold_bps: u16,
    liquidation_bonus_bps: u16,
    min_hold_time_secs: i64,
) -> Result<()> {
    require!(max_ltv_bps < liquidation_threshold_bps, crate::errors::LendingError::BorrowLimitExceeded);
    require!(liquidation_threshold_bps <= 10_000, crate::errors::LendingError::BorrowLimitExceeded);

    let reserve = &mut ctx.accounts.reserve;
    reserve.collateral_mint = ctx.accounts.collateral_mint.key();
    reserve.collateral_vault = ctx.accounts.collateral_vault.key();
    reserve.debt_mint = ctx.accounts.debt_mint.key();
    reserve.debt_vault = ctx.accounts.debt_vault.key();
    reserve.regime_state = ctx.accounts.regime_state.key();

    reserve.max_ltv_bps = max_ltv_bps;
    reserve.liquidation_threshold_bps = liquidation_threshold_bps;
    reserve.liquidation_bonus_bps = liquidation_bonus_bps;
    reserve.min_hold_time_secs = min_hold_time_secs;

    reserve.total_collateral_base = 0;
    reserve.total_debt = 0;

    reserve.authority_bump = ctx.bumps.reserve_authority;
    reserve.bump = ctx.bumps.reserve;
    Ok(())
}
