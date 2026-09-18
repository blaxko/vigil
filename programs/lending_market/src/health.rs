//! Fixed-point collateral valuation, borrow-limit, and liquidation math.
//!
//! All inputs here are already in "UI" (display) collateral units -- i.e.
//! the caller has already applied the Token-2022 scaled-ui-amount
//! multiplier via [`crate::token2022`] before calling anything in this
//! module. Prices are `regime_oracle`-style micro-USD (1e6 scale) per
//! whole collateral unit. USDC amounts are always 6-decimal base units.
//! No floats; every step is checked integer math.

use anchor_lang::prelude::*;

use crate::errors::LendingError;

const BPS_DENOM: u128 = 10_000;

fn pow10(decimals: u8) -> u128 {
    10u128.pow(decimals as u32)
}

/// USD value (in USDC 6-decimal base units) of `ui_amount` collateral units
/// at `price_micro` (micro-USD per whole unit), given the collateral
/// mint's decimal count.
pub fn collateral_value_usdc_base(ui_amount: u64, price_micro: u64, collateral_decimals: u8) -> Result<u64> {
    let value = (ui_amount as u128)
        .checked_mul(price_micro as u128)
        .and_then(|v| v.checked_div(pow10(collateral_decimals)))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok(value as u64)
}

/// Maximum USDC a position may borrow, given its collateral value at the
/// Borrow-Limit Price and the reserve's max LTV.
pub fn max_borrow_usdc(collateral_ui: u64, borrow_limit_price: u64, collateral_decimals: u8, max_ltv_bps: u16) -> Result<u64> {
    let value = collateral_value_usdc_base(collateral_ui, borrow_limit_price, collateral_decimals)? as u128;
    let max = value
        .checked_mul(max_ltv_bps as u128)
        .and_then(|v| v.checked_div(BPS_DENOM))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok(max as u64)
}

/// True if `debt` at or above `liquidation_threshold_bps` of the
/// collateral's value at the Liquidation Price -- i.e. the position is
/// eligible for liquidation.
pub fn is_liquidatable(
    collateral_ui: u64,
    liquidation_price: u64,
    collateral_decimals: u8,
    liquidation_threshold_bps: u16,
    debt: u64,
) -> Result<bool> {
    if debt == 0 {
        return Ok(false);
    }
    let value = collateral_value_usdc_base(collateral_ui, liquidation_price, collateral_decimals)? as u128;
    let threshold_value = value
        .checked_mul(liquidation_threshold_bps as u128)
        .and_then(|v| v.checked_div(BPS_DENOM))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok((debt as u128) >= threshold_value)
}

/// Health factor in bps: `(collateral value at liq. threshold) / debt *
/// 10_000`. >= 10_000 is healthy; < 10_000 is liquidation-eligible. Debt
/// of zero is treated as maximally healthy (`u64::MAX`).
pub fn health_factor_bps(
    collateral_ui: u64,
    liquidation_price: u64,
    collateral_decimals: u8,
    liquidation_threshold_bps: u16,
    debt: u64,
) -> Result<u64> {
    if debt == 0 {
        return Ok(u64::MAX);
    }
    let value = collateral_value_usdc_base(collateral_ui, liquidation_price, collateral_decimals)? as u128;
    let threshold_value = value
        .checked_mul(liquidation_threshold_bps as u128)
        .and_then(|v| v.checked_div(BPS_DENOM))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    let hf = threshold_value
        .checked_mul(BPS_DENOM)
        .and_then(|v| v.checked_div(debt as u128))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok(hf.min(u64::MAX as u128) as u64)
}

/// Collateral (in UI units) a liquidator receives for repaying
/// `repay_usdc`, priced at the Liquidation Price plus the flat liquidator
/// bonus.
pub fn seize_collateral_ui_for_repay(
    repay_usdc: u64,
    liquidation_price: u64,
    collateral_decimals: u8,
    liquidation_bonus_bps: u16,
) -> Result<u64> {
    require!(liquidation_price > 0, LendingError::InvalidScaledUiExtension);
    let bonus_value = (repay_usdc as u128)
        .checked_mul(BPS_DENOM + liquidation_bonus_bps as u128)
        .and_then(|v| v.checked_div(BPS_DENOM))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    let ui_amount = bonus_value
        .checked_mul(pow10(collateral_decimals))
        .and_then(|v| v.checked_div(liquidation_price as u128))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok(ui_amount as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    // $150.00 per share, 6-decimal collateral mint, 10 shares deposited.
    const PRICE: u64 = 150_000_000;
    const DECIMALS: u8 = 6;
    const TEN_SHARES: u64 = 10_000_000;

    #[test]
    fn collateral_value_matches_naive_multiplication() {
        // 10 shares * $150 = $1500 -> 1_500_000_000 USDC base units (6dp)
        assert_eq!(collateral_value_usdc_base(TEN_SHARES, PRICE, DECIMALS).unwrap(), 1_500_000_000);
    }

    #[test]
    fn max_borrow_respects_ltv() {
        // 70% LTV of $1500 = $1050
        let max = max_borrow_usdc(TEN_SHARES, PRICE, DECIMALS, 7_000).unwrap();
        assert_eq!(max, 1_050_000_000);
    }

    #[test]
    fn liquidatable_flips_at_threshold() {
        // liquidation threshold 80% of $1500 = $1200
        let debt_below = 1_199_000_000;
        let debt_above = 1_200_000_001;
        assert!(!is_liquidatable(TEN_SHARES, PRICE, DECIMALS, 8_000, debt_below).unwrap());
        assert!(is_liquidatable(TEN_SHARES, PRICE, DECIMALS, 8_000, debt_above).unwrap());
    }

    #[test]
    fn zero_debt_is_never_liquidatable_and_maximally_healthy() {
        assert!(!is_liquidatable(TEN_SHARES, PRICE, DECIMALS, 8_000, 0).unwrap());
        assert_eq!(health_factor_bps(TEN_SHARES, PRICE, DECIMALS, 8_000, 0).unwrap(), u64::MAX);
    }

    #[test]
    fn health_factor_below_10000_bps_matches_is_liquidatable() {
        let debt = 1_300_000_000; // above the $1200 threshold
        let hf = health_factor_bps(TEN_SHARES, PRICE, DECIMALS, 8_000, debt).unwrap();
        assert!(hf < 10_000);
        assert!(is_liquidatable(TEN_SHARES, PRICE, DECIMALS, 8_000, debt).unwrap());
    }

    #[test]
    fn seize_amount_includes_liquidator_bonus() {
        // repay $100 at $150/share with a 5% bonus -> $105 worth of shares
        // -> 105 / 150 = 0.7 shares -> 700_000 base units (6dp)
        let seized = seize_collateral_ui_for_repay(100_000_000, PRICE, DECIMALS, 500).unwrap();
        assert_eq!(seized, 700_000);
    }
}
