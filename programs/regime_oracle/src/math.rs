//! Anchor-decay-clamp pricing math for Vigil's regime oracle.
//!
//! All prices are represented as u64 fixed-point values scaled by
//! `PRICE_SCALE` (1e6, i.e. "micro-USD"). No floats anywhere in this
//! module — every operation is a checked integer operation so the
//! program can never silently overflow/underflow or round in a way
//! that isn't explicit here.
//!
//! Two independent EMAs are produced from the same regime state:
//! - Borrow-Limit Price: slow-smoothed, tightens conservatively while closed.
//! - Liquidation Price: fast-smoothed, widens its safety band while closed.
//! They deliberately never share a smoothing speed or a target -- over-borrow
//! risk (needs a tight, conservative number) and unjust-liquidation risk
//! (needs a forgiving, wide number) are opposite failure modes.

use anchor_lang::prelude::*;

use crate::errors::RegimeError;

pub const PRICE_SCALE: u128 = 1_000_000; // 1e6, "micro-USD" fixed point
pub const BPS_DENOM: u128 = 10_000;

/// EMA speed for the Borrow-Limit Price while the market is closed (slow).
pub const BORROW_LIMIT_ALPHA_BPS: u128 = 500; // 5% of the gap closed per tick
/// EMA speed for the Liquidation Price while the market is closed (fast).
pub const LIQUIDATION_ALPHA_BPS: u128 = 1_500; // 15% of the gap closed per tick

/// Hard per-tick clamp: neither price may move more than this fraction of
/// its previous value in a single `update_price` call, regardless of what
/// the EMA math would otherwise produce. This is what makes "per tick"
/// mean something enforceable.
pub const NORMAL_MAX_MOVE_BPS: u128 = 300; // 3% per tick
/// One-time wider clamp applied on the first tick after the market reopens,
/// so the price can snap back toward the fresh Pyth print instead of
/// crawling back over many ticks.
pub const REOPEN_MAX_MOVE_BPS: u128 = 5_000; // 50% on reopen only

/// How far the Borrow-Limit Price is allowed to tighten below the blended
/// target, and how far the Liquidation Price is allowed to widen above it,
/// once a closure has been in effect for at least `RAMP_SECONDS`.
pub const BORROW_TIGHTEN_MAX_BPS: u128 = 800; // up to 8% more conservative
pub const LIQUIDATION_WIDEN_MAX_BPS: u128 = 1_200; // up to 12% more forgiving
/// Time (seconds) over which the tighten/widen ramps linearly from 0 to max.
pub const RAMP_SECONDS: i64 = 3_600; // 1 hour

/// Caps how much weight the DEX TWAP can have in the closed-market blend,
/// even if posted liquidity is very deep. Vigil never fully hands pricing
/// over to a single DEX pool.
pub const MAX_DEX_WEIGHT_BPS: u128 = 6_000; // 60% max
/// Liquidity (in the same USD fixed-point units as price * base amount)
/// at or above which the DEX reference earns its full allowed weight.
pub const LIQUIDITY_NORM: u128 = 250_000 * PRICE_SCALE; // $250k

fn checked_mul_div(a: u128, num: u128, den: u128) -> Result<u128> {
    require!(den != 0, RegimeError::Overflow);
    a.checked_mul(num)
        .and_then(|v| v.checked_div(den))
        .ok_or_else(|| error!(RegimeError::Overflow))
}

/// Conservative (lower) bound: Pyth price minus confidence, floored at 1.
/// Used for the Borrow-Limit Price while the market is open, so a
/// manipulated-*up* print can't inflate what a user is allowed to borrow.
pub fn conservative_lower(price: u64, conf: u64) -> Result<u64> {
    let p = price as u128;
    let c = conf as u128;
    let lowered = p.checked_sub(c).unwrap_or(1).max(1);
    Ok(lowered as u64)
}

/// Protective (upper) bound: Pyth price plus confidence. Used for the
/// Liquidation Price while the market is open, so a manipulated-*down*
/// print can't trigger an unjust liquidation.
pub fn protective_upper(price: u64, conf: u64) -> Result<u64> {
    let p = price as u128;
    let c = conf as u128;
    let raised = p.checked_add(c).ok_or_else(|| error!(RegimeError::Overflow))?;
    Ok(raised as u64)
}

/// Liquidity-dampened blend weight (in bps) that the DEX reference price
/// gets against the anchor price, while the market is closed. A thin pool
/// (low posted liquidity) is capped close to zero weight so a quiet
/// weekend pool can't be used to move the blended price.
pub fn dex_weight_bps(dex_liquidity: u128) -> Result<u128> {
    let raw = checked_mul_div(dex_liquidity, MAX_DEX_WEIGHT_BPS, LIQUIDITY_NORM)?;
    Ok(raw.min(MAX_DEX_WEIGHT_BPS))
}

/// Blend the last-open "anchor" price with the keeper-posted DEX reference,
/// weighted by the DEX reference's own liquidity depth.
pub fn blended_target(anchor_price: u64, dex_price: u64, dex_liquidity: u128) -> Result<u64> {
    require!(anchor_price > 0 && dex_price > 0, RegimeError::NonPositivePrice);
    let weight = dex_weight_bps(dex_liquidity)?;
    let anchor_component = checked_mul_div(anchor_price as u128, BPS_DENOM - weight, BPS_DENOM)?;
    let dex_component = checked_mul_div(dex_price as u128, weight, BPS_DENOM)?;
    let sum = anchor_component
        .checked_add(dex_component)
        .ok_or_else(|| error!(RegimeError::Overflow))?;
    Ok(sum as u64)
}

/// Linear ramp in [0, max_bps] as a closure ages from 0 to RAMP_SECONDS.
pub fn ramp_bps(seconds_since_close: i64, max_bps: u128) -> Result<u128> {
    if seconds_since_close <= 0 {
        return Ok(0);
    }
    let clamped_secs = seconds_since_close.min(RAMP_SECONDS) as u128;
    checked_mul_div(max_bps, clamped_secs, RAMP_SECONDS as u128)
}

/// Borrow-Limit target while closed: the blended price, tightened downward
/// by a ramp that grows the longer the closure has lasted.
pub fn borrow_limit_target_closed(blended: u64, seconds_since_close: i64) -> Result<u64> {
    let tighten = ramp_bps(seconds_since_close, BORROW_TIGHTEN_MAX_BPS)?;
    let factor_num = BPS_DENOM.checked_sub(tighten).ok_or_else(|| error!(RegimeError::Overflow))?;
    let out = checked_mul_div(blended as u128, factor_num, BPS_DENOM)?;
    Ok(out.max(1) as u64)
}

/// Liquidation target while closed: the blended price, widened upward by a
/// ramp that grows the longer the closure has lasted.
pub fn liquidation_target_closed(blended: u64, seconds_since_close: i64) -> Result<u64> {
    let widen = ramp_bps(seconds_since_close, LIQUIDATION_WIDEN_MAX_BPS)?;
    let factor_num = BPS_DENOM.checked_add(widen).ok_or_else(|| error!(RegimeError::Overflow))?;
    let out = checked_mul_div(blended as u128, factor_num, BPS_DENOM)?;
    Ok(out as u64)
}

/// One EMA step: moves `current` a fraction `alpha_bps` of the way toward
/// `target`. Handles both directions (target above or below current)
/// without ever going through a signed intermediate on-chain type.
pub fn ema_step(current: u64, target: u64, alpha_bps: u128) -> Result<u64> {
    let cur = current as u128;
    let tgt = target as u128;
    let new_val = if tgt >= cur {
        let gap = tgt.checked_sub(cur).ok_or_else(|| error!(RegimeError::Overflow))?;
        let delta = checked_mul_div(gap, alpha_bps, BPS_DENOM)?;
        cur.checked_add(delta).ok_or_else(|| error!(RegimeError::Overflow))?
    } else {
        let gap = cur.checked_sub(tgt).ok_or_else(|| error!(RegimeError::Overflow))?;
        let delta = checked_mul_div(gap, alpha_bps, BPS_DENOM)?;
        cur.checked_sub(delta).ok_or_else(|| error!(RegimeError::Overflow))?
    };
    Ok(new_val as u64)
}

/// Hard per-tick clamp around `previous`, capping the proposed value to at
/// most `max_move_bps` away from it in either direction.
pub fn clamp_move(previous: u64, proposed: u64, max_move_bps: u128) -> Result<u64> {
    let prev = previous as u128;
    let prop = proposed as u128;
    let max_delta = checked_mul_div(prev, max_move_bps, BPS_DENOM)?;
    let upper = prev.checked_add(max_delta).ok_or_else(|| error!(RegimeError::Overflow))?;
    let lower = prev.checked_sub(max_delta).unwrap_or(1).max(1);
    Ok(prop.clamp(lower, upper) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conservative_lower_subtracts_confidence() {
        assert_eq!(conservative_lower(100_000_000, 1_000_000).unwrap(), 99_000_000);
    }

    #[test]
    fn conservative_lower_floors_at_one() {
        assert_eq!(conservative_lower(500, 10_000).unwrap(), 1);
    }

    #[test]
    fn protective_upper_adds_confidence() {
        assert_eq!(protective_upper(100_000_000, 1_000_000).unwrap(), 101_000_000);
    }

    #[test]
    fn dex_weight_scales_with_liquidity_and_caps() {
        assert_eq!(dex_weight_bps(0).unwrap(), 0);
        assert_eq!(dex_weight_bps(LIQUIDITY_NORM).unwrap(), MAX_DEX_WEIGHT_BPS);
        assert_eq!(dex_weight_bps(LIQUIDITY_NORM * 10).unwrap(), MAX_DEX_WEIGHT_BPS);
        assert_eq!(dex_weight_bps(LIQUIDITY_NORM / 2).unwrap(), MAX_DEX_WEIGHT_BPS / 2);
    }

    #[test]
    fn thin_pool_cannot_move_blended_price_much() {
        // $5k of liquidity against a $250k norm -> only 2% of max weight (60%) = 1.2% weight.
        let anchor = 100_000_000; // $100.00
        let dex = 200_000_000; // a manipulated $200.00 print on a thin pool
        let liquidity = 5_000 * PRICE_SCALE;
        let blended = blended_target(anchor, dex, liquidity).unwrap();
        // Should stay within ~1.2% of the anchor, nowhere near the dex print.
        assert!(blended < anchor + anchor / 50);
    }

    #[test]
    fn deep_pool_pulls_blend_toward_dex_price_up_to_cap() {
        let anchor = 100_000_000;
        let dex = 200_000_000;
        let blended = blended_target(anchor, dex, LIQUIDITY_NORM * 5).unwrap();
        // Capped at MAX_DEX_WEIGHT_BPS (60%) toward dex price.
        let expected = anchor as u128 * 40 / 100 + dex as u128 * 60 / 100;
        assert_eq!(blended as u128, expected);
    }

    #[test]
    fn borrow_limit_tightens_and_liquidation_widens_as_closure_ages() {
        let blended = 100_000_000u64;
        let early = borrow_limit_target_closed(blended, 60).unwrap();
        let late = borrow_limit_target_closed(blended, RAMP_SECONDS).unwrap();
        assert!(early > late, "borrow limit should tighten further the longer closure lasts");
        assert!(late < blended);

        let early_liq = liquidation_target_closed(blended, 60).unwrap();
        let late_liq = liquidation_target_closed(blended, RAMP_SECONDS).unwrap();
        assert!(late_liq > early_liq, "liquidation band should widen further over time");
        assert!(late_liq > blended);
    }

    #[test]
    fn ramp_saturates_after_ramp_seconds() {
        assert_eq!(ramp_bps(RAMP_SECONDS, 800).unwrap(), 800);
        assert_eq!(ramp_bps(RAMP_SECONDS * 10, 800).unwrap(), 800);
        assert_eq!(ramp_bps(0, 800).unwrap(), 0);
        assert_eq!(ramp_bps(-100, 800).unwrap(), 0);
    }

    #[test]
    fn ema_step_moves_toward_target_by_alpha_fraction() {
        let cur = 100_000_000u64;
        let tgt = 110_000_000u64;
        // 5% of a $10 gap = $0.50
        let next = ema_step(cur, tgt, 500).unwrap();
        assert_eq!(next, 100_500_000);
    }

    #[test]
    fn ema_step_moves_downward_too() {
        let cur = 100_000_000u64;
        let tgt = 90_000_000u64;
        let next = ema_step(cur, tgt, 1_500).unwrap();
        assert_eq!(next, 98_500_000);
    }

    #[test]
    fn clamp_move_bounds_upward_and_downward_moves() {
        let prev = 100_000_000u64;
        // proposed move of +50% should be clamped to +3%
        let clamped_up = clamp_move(prev, 150_000_000, NORMAL_MAX_MOVE_BPS).unwrap();
        assert_eq!(clamped_up, 103_000_000);
        // proposed move of -50% should be clamped to -3%
        let clamped_down = clamp_move(prev, 50_000_000, NORMAL_MAX_MOVE_BPS).unwrap();
        assert_eq!(clamped_down, 97_000_000);
        // a move within bounds passes through unchanged
        let unclamped = clamp_move(prev, 101_000_000, NORMAL_MAX_MOVE_BPS).unwrap();
        assert_eq!(unclamped, 101_000_000);
    }

    #[test]
    fn reopen_clamp_is_wider_than_normal_clamp() {
        assert!(REOPEN_MAX_MOVE_BPS > NORMAL_MAX_MOVE_BPS);
        let prev = 100_000_000u64;
        let shocked_target = 140_000_000u64; // a big gap-up at reopen
        let normal = clamp_move(prev, shocked_target, NORMAL_MAX_MOVE_BPS).unwrap();
        let reopen = clamp_move(prev, shocked_target, REOPEN_MAX_MOVE_BPS).unwrap();
        assert!(reopen > normal, "reopen clamp should allow snapping closer to the fresh print");
    }

    #[test]
    fn full_closure_tick_keeps_borrow_limit_below_liquidation_price() {
        // Regression guard: the two outputs must never invert regardless of
        // how long the closure has run, since the lending_market program
        // trusts borrow_limit <= liquidation as an invariant.
        let anchor = 100_000_000u64;
        let dex = 100_000_000u64;
        let liquidity = LIQUIDITY_NORM;
        for secs in [0i64, 60, 1_800, 3_600, 36_000] {
            let blended = blended_target(anchor, dex, liquidity).unwrap();
            let bl = borrow_limit_target_closed(blended, secs).unwrap();
            let lq = liquidation_target_closed(blended, secs).unwrap();
            assert!(bl <= lq, "borrow limit {bl} exceeded liquidation price {lq} at {secs}s");
        }
    }
}
