use anchor_lang::prelude::*;

use crate::state::RegimeState;

#[derive(Accounts)]
#[instruction(price_feed_id: [u8; 32])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The keeper authority permitted to call `set_regime` and
    /// `post_dex_reference` for this market. Set once at init; there is no
    /// admin instruction to change it (out of scope per the MVP brief --
    /// redeploy with a new keeper if it needs to rotate).
    /// CHECK: stored verbatim as the keeper authority pubkey, not read from.
    pub keeper_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = RegimeState::SIZE,
        seeds = [RegimeState::SEED_PREFIX, price_feed_id.as_ref()],
        bump,
    )]
    pub regime_state: Account<'info, RegimeState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    price_feed_id: [u8; 32],
    initial_price: u64,
    pyth_receiver_program: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    let state = &mut ctx.accounts.regime_state;

    state.keeper_authority = ctx.accounts.keeper_authority.key();
    state.pyth_receiver_program = pyth_receiver_program;
    state.price_feed_id = price_feed_id;
    state.is_open = true;
    state.last_regime_change_ts = clock.unix_timestamp;
    state.pending_reopen_snap = false;

    state.anchor_price = initial_price;
    state.anchor_ts = clock.unix_timestamp;

    state.dex_reference_price = initial_price;
    state.dex_reference_liquidity = 0;
    state.dex_reference_ts = clock.unix_timestamp;

    state.borrow_limit_price = initial_price;
    state.liquidation_price = initial_price;
    state.last_update_ts = clock.unix_timestamp;

    state.bump = ctx.bumps.regime_state;
    Ok(())
}
