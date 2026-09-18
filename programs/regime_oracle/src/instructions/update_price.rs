use anchor_lang::prelude::*;
use crate::errors::RegimeError;
use crate::math;
use crate::pyth_types::PriceUpdateV2;
use crate::state::RegimeState;

/// Maximum age (seconds) a Pyth price update may have and still be trusted.
/// Never read Pyth without this bound -- an unchecked read is exactly the
/// stale-price failure mode Vigil exists to price around, not reproduce.
pub const MAX_PRICE_AGE_SECS: u64 = 60;

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    /// Permissionless: anyone may crank a recompute. Every input this
    /// instruction trusts (the Pyth update, the keeper-posted DEX
    /// reference, the regime flag) is independently authenticated --
    /// Pyth's own signature/verification, or a prior keeper-only
    /// instruction -- so the caller here doesn't need to be privileged.
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [RegimeState::SEED_PREFIX, regime_state.price_feed_id.as_ref()],
        bump = regime_state.bump,
    )]
    pub regime_state: Account<'info, RegimeState>,

    /// Required and read only while the market is open; ignored while
    /// closed (during closure Vigil deliberately does NOT trust Pyth's
    /// frozen weekend print -- that's the entire point of the regime
    /// module). Pass any account while closed; it will simply be skipped.
    ///
    /// Deliberately `UncheckedAccount`, not `Account<'info, PriceUpdateV2>`:
    /// see the `PYTH_RECEIVER_PROGRAM_ID` doc comment above. Ownership and
    /// deserialization are both checked explicitly in the handler instead.
    pub price_update: Option<UncheckedAccount<'info>>,
}

pub fn handler(ctx: Context<UpdatePrice>) -> Result<()> {
    let clock = Clock::get()?;
    let state = &mut ctx.accounts.regime_state;

    let (borrow_target, liquidation_target, new_anchor) = if state.is_open {
        let price_update_info = ctx
            .accounts
            .price_update
            .as_ref()
            .ok_or(RegimeError::MissingDexReference)?;

        require_keys_eq!(*price_update_info.owner, state.pyth_receiver_program, RegimeError::WrongPriceFeed);
        let data = price_update_info.try_borrow_data()?;
        let price_update = PriceUpdateV2::try_deserialize(&mut data.as_ref())?;
        drop(data);

        let price = price_update.get_price_no_older_than(&clock, MAX_PRICE_AGE_SECS, &state.price_feed_id)?;

        require!(price.price > 0 && price.conf > 0, RegimeError::InvalidPythPrice);

        // Normalize Pyth's (price, exponent) pair into our micro-USD (1e6)
        // fixed point, regardless of the feed's native exponent.
        let normalized_price = normalize_to_micro_usd(price.price, price.exponent)?;
        let normalized_conf = normalize_to_micro_usd(price.conf as i64, price.exponent)?;

        let borrow = math::conservative_lower(normalized_price, normalized_conf)?;
        let liquidation = math::protective_upper(normalized_price, normalized_conf)?;
        (borrow, liquidation, Some(normalized_price))
    } else {
        require!(state.dex_reference_price > 0, RegimeError::MissingDexReference);

        let blended = math::blended_target(
            state.anchor_price,
            state.dex_reference_price,
            state.dex_reference_liquidity,
        )?;
        let seconds_closed = clock.unix_timestamp.saturating_sub(state.last_regime_change_ts);
        let borrow = math::borrow_limit_target_closed(blended, seconds_closed)?;
        let liquidation = math::liquidation_target_closed(blended, seconds_closed)?;
        (borrow, liquidation, None)
    };

    if let Some(anchor) = new_anchor {
        state.anchor_price = anchor;
        state.anchor_ts = clock.unix_timestamp;
    }

    let max_move_bps = if state.pending_reopen_snap {
        math::REOPEN_MAX_MOVE_BPS
    } else {
        math::NORMAL_MAX_MOVE_BPS
    };

    let borrow_eased = math::ema_step(state.borrow_limit_price, borrow_target, math::BORROW_LIMIT_ALPHA_BPS)?;
    let liquidation_eased = math::ema_step(state.liquidation_price, liquidation_target, math::LIQUIDATION_ALPHA_BPS)?;

    state.borrow_limit_price = math::clamp_move(state.borrow_limit_price, borrow_eased, max_move_bps)?;
    state.liquidation_price = math::clamp_move(state.liquidation_price, liquidation_eased, max_move_bps)?;

    // Never let the two invert: the lending market trusts
    // borrow_limit_price <= liquidation_price as an invariant.
    if state.borrow_limit_price > state.liquidation_price {
        state.liquidation_price = state.borrow_limit_price;
    }

    state.pending_reopen_snap = false;
    state.last_update_ts = clock.unix_timestamp;
    Ok(())
}

/// Converts a Pyth (price, exponent) pair into u64 micro-USD (1e6 scale).
fn normalize_to_micro_usd(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, RegimeError::InvalidPythPrice);
    let price = price as i128;
    // normalized = price * 10^exponent * 10^6 = price * 10^(exponent + 6)
    let pow = exponent + 6;
    let scaled: i128 = if pow >= 0 {
        price
            .checked_mul(10i128.pow(pow as u32))
            .ok_or_else(|| error!(RegimeError::InvalidPythPrice))?
    } else {
        price
            .checked_div(10i128.pow((-pow) as u32))
            .ok_or_else(|| error!(RegimeError::InvalidPythPrice))?
    };
    require!(scaled > 0, RegimeError::InvalidPythPrice);
    Ok(scaled as u64)
}
