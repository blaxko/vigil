use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};
use regime_oracle::state::RegimeState;

use crate::errors::LendingError;
use crate::oracle::assert_oracle_fresh;
use crate::state::{Position, Reserve};
use crate::{health, token2022};

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = debt_vault @ LendingError::MintMismatch,
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

    #[account(address = reserve.debt_mint @ LendingError::MintMismatch)]
    pub debt_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub owner_debt_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub debt_vault: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA signer for vault transfers; seeds validated below.
    #[account(seeds = [Reserve::AUTHORITY_SEED_PREFIX, reserve.key().as_ref()], bump = reserve.authority_bump)]
    pub reserve_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::BorrowLimitExceeded);

    let clock = Clock::get()?;
    assert_oracle_fresh(ctx.accounts.regime_state.last_update_ts, clock.unix_timestamp)?;

    let position = &mut ctx.accounts.position;
    let reserve = &mut ctx.accounts.reserve;

    let multiplier_fp = token2022::read_multiplier_fp(&ctx.accounts.collateral_mint.to_account_info(), clock.unix_timestamp)?;
    let collateral_ui = token2022::base_to_ui_amount(position.collateral_base, multiplier_fp)?;

    let new_debt = position
        .debt_amount
        .checked_add(amount)
        .ok_or(LendingError::BorrowLimitExceeded)?;

    let max_borrow = health::max_borrow_usdc(
        collateral_ui,
        ctx.accounts.regime_state.borrow_limit_price,
        ctx.accounts.collateral_mint.decimals,
        reserve.max_ltv_bps,
    )?;
    require!(new_debt <= max_borrow, LendingError::BorrowLimitExceeded);

    position.debt_amount = new_debt;
    position.last_borrow_ts = clock.unix_timestamp;

    reserve.total_debt = reserve
        .total_debt
        .checked_add(amount)
        .ok_or(LendingError::BorrowLimitExceeded)?;

    let reserve_key = reserve.key();
    let signer_seeds: &[&[u8]] = &[Reserve::AUTHORITY_SEED_PREFIX, reserve_key.as_ref(), &[reserve.authority_bump]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.debt_vault.to_account_info(),
                mint: ctx.accounts.debt_mint.to_account_info(),
                to: ctx.accounts.owner_debt_ata.to_account_info(),
                authority: ctx.accounts.reserve_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
        ctx.accounts.debt_mint.decimals,
    )?;

    Ok(())
}
