use anchor_lang::prelude::*;

use crate::errors::RegimeError;
use crate::state::RegimeState;

#[derive(Accounts)]
pub struct SetRegime<'info> {
    /// Must match `regime_state.keeper_authority`. Permissioned so no
    /// arbitrary signer can flip a market's open/closed flag.
    pub keeper_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [RegimeState::SEED_PREFIX, regime_state.price_feed_id.as_ref()],
        bump = regime_state.bump,
        has_one = keeper_authority @ RegimeError::UnauthorizedKeeper,
    )]
    pub regime_state: Account<'info, RegimeState>,
}

/// Flips the regime flag. On Open -> Closed, freezes `anchor_price` at the
/// last known `borrow_limit`/`liquidation` midpoint context (the caller is
/// expected to have called `update_price` against a fresh Pyth read first
/// in the same transaction or immediately prior, so `borrow_limit_price`/
/// `liquidation_price` already reflect the final live print). On
/// Closed -> Open, arms `pending_reopen_snap` so the next `update_price`
/// call applies the wider one-time reopen clamp instead of the normal one.
pub fn handler(ctx: Context<SetRegime>, is_open: bool) -> Result<()> {
    let clock = Clock::get()?;
    let state = &mut ctx.accounts.regime_state;

    require!(state.is_open != is_open, RegimeError::RegimeUnchanged);

    if state.is_open && !is_open {
        // Open -> Closed: capture the anchor the decay function will blend
        // away from for the duration of the closure.
        state.anchor_price = state.borrow_limit_price.max(1);
        state.anchor_ts = clock.unix_timestamp;
        state.pending_reopen_snap = false;
    } else {
        // Closed -> Open: let the next live Pyth-driven update_price call
        // snap most of the way back to the fresh print in one tick.
        state.pending_reopen_snap = true;
    }

    state.is_open = is_open;
    state.last_regime_change_ts = clock.unix_timestamp;
    Ok(())
}
