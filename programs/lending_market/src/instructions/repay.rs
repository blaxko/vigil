use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::LendingError;
use crate::state::{Position, Reserve};

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = debt_vault @ LendingError::MintMismatch)]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [Position::SEED_PREFIX, reserve.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
    )]
    pub position: Account<'info, Position>,

    #[account(address = reserve.debt_mint @ LendingError::MintMismatch)]
    pub debt_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub owner_debt_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub debt_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Fully closes a position's debt when `amount` >= outstanding debt (any
/// excess beyond the debt is rejected, not silently swallowed -- the
/// caller must pass the exact or lesser amount). No interest accrues in
/// the MVP, so "repay" is a straight principal paydown.
pub fn handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::RepayExceedsDebt);

    let position = &mut ctx.accounts.position;
    require!(amount <= position.debt_amount, LendingError::RepayExceedsDebt);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_debt_ata.to_account_info(),
                mint: ctx.accounts.debt_mint.to_account_info(),
                to: ctx.accounts.debt_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.debt_mint.decimals,
    )?;

    position.debt_amount = position
        .debt_amount
        .checked_sub(amount)
        .ok_or(LendingError::RepayExceedsDebt)?;

    let reserve = &mut ctx.accounts.reserve;
    reserve.total_debt = reserve
        .total_debt
        .checked_sub(amount)
        .ok_or(LendingError::RepayExceedsDebt)?;

    Ok(())
}
