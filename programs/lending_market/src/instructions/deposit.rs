use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::state::{Position, Reserve};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = collateral_vault @ crate::errors::LendingError::MintMismatch)]
    pub reserve: Account<'info, Reserve>,

    #[account(
        init_if_needed,
        payer = owner,
        space = Position::SIZE,
        seeds = [Position::SEED_PREFIX, reserve.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(address = reserve.collateral_mint @ crate::errors::LendingError::MintMismatch)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub owner_collateral_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount_base: u64) -> Result<()> {
    require!(amount_base > 0, crate::errors::LendingError::InsufficientCollateral);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_collateral_ata.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount_base,
        ctx.accounts.collateral_mint.decimals,
    )?;

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.reserve = ctx.accounts.reserve.key();
        position.debt_amount = 0;
        position.last_borrow_ts = 0;
        position.bump = ctx.bumps.position;
    }
    position.collateral_base = position
        .collateral_base
        .checked_add(amount_base)
        .ok_or(crate::errors::LendingError::InsufficientCollateral)?;

    let reserve = &mut ctx.accounts.reserve;
    reserve.total_collateral_base = reserve
        .total_collateral_base
        .checked_add(amount_base)
        .ok_or(crate::errors::LendingError::InsufficientCollateral)?;

    Ok(())
}
