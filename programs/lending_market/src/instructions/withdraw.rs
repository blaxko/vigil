use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};
use regime_oracle::state::RegimeState;

use crate::errors::LendingError;
use crate::oracle::assert_oracle_fresh;
use crate::state::{Position, Reserve};
use crate::{health, token2022};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = collateral_vault @ LendingError::MintMismatch,
        has_one = regime_state @ LendingError::MintMismatch,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [Position::SEED_PREFIX, reserve.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
    )]
    pub position: Account<'info, Position>,

    pub regime_state: Account<'info, RegimeState>,

    #[account(address = reserve.collateral_mint @ LendingError::MintMismatch)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub owner_collateral_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA signer for vault transfers; seeds validated below.
    #[account(seeds = [Reserve::AUTHORITY_SEED_PREFIX, reserve.key().as_ref()], bump = reserve.authority_bump)]
    pub reserve_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Withdraw>, amount_base: u64) -> Result<()> {
    let clock = Clock::get()?;
    let position = &mut ctx.accounts.position;
    let reserve = &mut ctx.accounts.reserve;

    require!(amount_base > 0 && amount_base <= position.collateral_base, LendingError::InsufficientCollateral);
    require!(
        clock.unix_timestamp >= position.last_borrow_ts.saturating_add(reserve.min_hold_time_secs),
        LendingError::PositionHoldTimeActive
    );

    let remaining_base = position.collateral_base - amount_base;

    if position.debt_amount > 0 {
        assert_oracle_fresh(ctx.accounts.regime_state.last_update_ts, clock.unix_timestamp)?;

        let multiplier_fp = token2022::read_multiplier_fp(&ctx.accounts.collateral_mint.to_account_info(), clock.unix_timestamp)?;
        let remaining_ui = token2022::base_to_ui_amount(remaining_base, multiplier_fp)?;

        let max_borrow = health::max_borrow_usdc(
            remaining_ui,
            ctx.accounts.regime_state.borrow_limit_price,
            ctx.accounts.collateral_mint.decimals,
            reserve.max_ltv_bps,
        )?;
        require!(position.debt_amount <= max_borrow, LendingError::WithdrawalExceedsLimit);
    }

    position.collateral_base = remaining_base;
    reserve.total_collateral_base = reserve
        .total_collateral_base
        .checked_sub(amount_base)
        .ok_or(LendingError::InsufficientCollateral)?;

    let reserve_key = reserve.key();
    let signer_seeds: &[&[u8]] = &[Reserve::AUTHORITY_SEED_PREFIX, reserve_key.as_ref(), &[reserve.authority_bump]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.collateral_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.owner_collateral_ata.to_account_info(),
                authority: ctx.accounts.reserve_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount_base,
        ctx.accounts.collateral_mint.decimals,
    )?;

    Ok(())
}
