use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};
use regime_oracle::state::RegimeState;

use crate::errors::LendingError;
use crate::oracle::assert_oracle_fresh;
use crate::state::{Position, Reserve};
use crate::{health, token2022};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// Permissionless: any funded wallet may liquidate an eligible
    /// position, per the brief's bot-triggered liquidation-engine design.
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        has_one = collateral_vault @ LendingError::MintMismatch,
        has_one = debt_vault @ LendingError::MintMismatch,
        has_one = regime_state @ LendingError::MintMismatch,
    )]
    pub reserve: Account<'info, Reserve>,

    #[account(
        mut,
        seeds = [Position::SEED_PREFIX, reserve.key().as_ref(), position.owner.as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    pub regime_state: Account<'info, RegimeState>,

    #[account(address = reserve.collateral_mint @ LendingError::MintMismatch)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    #[account(address = reserve.debt_mint @ LendingError::MintMismatch)]
    pub debt_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub liquidator_debt_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub liquidator_collateral_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub debt_vault: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA signer for vault transfers; seeds validated below.
    #[account(seeds = [Reserve::AUTHORITY_SEED_PREFIX, reserve.key().as_ref()], bump = reserve.authority_bump)]
    pub reserve_authority: UncheckedAccount<'info>,

    /// Collateral and debt mints can be owned by different token programs
    /// (e.g. AAPLx under Token-2022, USDC under the legacy Token program),
    /// and liquidate is the one instruction that moves both in a single
    /// call -- so, unlike deposit/withdraw/borrow/repay, it needs two
    /// separate token-program references rather than one shared one.
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub debt_token_program: Interface<'info, TokenInterface>,
}

/// Full-position liquidation only (no Dutch auction, no partial-liquidation
/// optimization -- explicitly out of scope for the MVP, see brief section
/// 6). Checked against the Liquidation Price with a staleness guard: a
/// stale oracle rejects the liquidation outright rather than liquidating
/// on a possibly-wrong price.
pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let clock = Clock::get()?;
    assert_oracle_fresh(ctx.accounts.regime_state.last_update_ts, clock.unix_timestamp)?;

    let position = &mut ctx.accounts.position;
    let reserve = &mut ctx.accounts.reserve;
    require!(position.debt_amount > 0, LendingError::PositionNotLiquidatable);

    let multiplier_fp = token2022::read_multiplier_fp(&ctx.accounts.collateral_mint.to_account_info(), clock.unix_timestamp)?;
    let collateral_ui = token2022::base_to_ui_amount(position.collateral_base, multiplier_fp)?;

    let liquidatable = health::is_liquidatable(
        collateral_ui,
        ctx.accounts.regime_state.liquidation_price,
        ctx.accounts.collateral_mint.decimals,
        reserve.liquidation_threshold_bps,
        position.debt_amount,
    )?;
    require!(liquidatable, LendingError::PositionNotLiquidatable);

    let repay_amount = position.debt_amount;

    let seize_ui = health::seize_collateral_ui_for_repay(
        repay_amount,
        ctx.accounts.regime_state.liquidation_price,
        ctx.accounts.collateral_mint.decimals,
        reserve.liquidation_bonus_bps,
    )?;
    let seize_base = token2022::ui_to_base_amount(seize_ui, multiplier_fp)?;
    // Cap at whatever collateral the position actually holds -- bad-debt
    // socialization is explicitly out of scope for the MVP.
    let seize_base = seize_base.min(position.collateral_base);

    // 1) Liquidator repays the full outstanding debt into the debt vault.
    transfer_checked(
        CpiContext::new(
            ctx.accounts.debt_token_program.key(),
            TransferChecked {
                from: ctx.accounts.liquidator_debt_ata.to_account_info(),
                mint: ctx.accounts.debt_mint.to_account_info(),
                to: ctx.accounts.debt_vault.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        ),
        repay_amount,
        ctx.accounts.debt_mint.decimals,
    )?;

    // 2) Liquidator receives the discounted collateral from the vault.
    let reserve_key = reserve.key();
    let signer_seeds: &[&[u8]] = &[Reserve::AUTHORITY_SEED_PREFIX, reserve_key.as_ref(), &[reserve.authority_bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.collateral_token_program.key(),
            TransferChecked {
                from: ctx.accounts.collateral_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.liquidator_collateral_ata.to_account_info(),
                authority: ctx.accounts.reserve_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        seize_base,
        ctx.accounts.collateral_mint.decimals,
    )?;

    position.debt_amount = 0;
    position.collateral_base = position
        .collateral_base
        .checked_sub(seize_base)
        .ok_or(LendingError::InsufficientCollateral)?;

    reserve.total_debt = reserve
        .total_debt
        .checked_sub(repay_amount)
        .ok_or(LendingError::RepayExceedsDebt)?;
    reserve.total_collateral_base = reserve
        .total_collateral_base
        .checked_sub(seize_base)
        .ok_or(LendingError::InsufficientCollateral)?;

    Ok(())
}
