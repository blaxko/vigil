//! Token-2022 scaled-ui-amount helpers.
//!
//! AAPLx is minted with the `ScaledUiAmount` extension: the raw ("base")
//! amount stored in token accounts is NOT the real share count -- it must
//! be multiplied by a mint-level multiplier (which the issuer can update
//! over time, e.g. for stock splits) to get the display/UI amount that
//! actually corresponds to a share of AAPL and that Pyth's AAPL price
//! applies to. Every place this program computes a USD value from a
//! collateral base-amount MUST go through `base_to_ui_amount` first --
//! never assume base amount == display amount.
//!
//! The SPL Token-2022 program stores the multiplier as an IEEE-754 f64
//! (`PodF64`) inside the mint's TLV extension data -- that's the token
//! standard's own on-chain format, not a choice made here. We read it
//! exactly once per instruction at this boundary and immediately convert
//! it into a fixed-point bps-style integer (`MULTIPLIER_SCALE`-scaled),
//! so every arithmetic step after this module is ordinary checked integer
//! math, consistent with the "no floats in program math" rule for
//! everything Vigil itself designs.

use anchor_lang::prelude::*;
// A direct, newer dependency on spl-token-2022 rather than the older
// version anchor-spl 0.30.1 re-exports: that older version predates the
// ScaledUiAmount extension entirely. This is only used to parse mint TLV
// data into primitive values (never to pass its types across a CPI or
// Anchor account boundary), so having two spl-token-2022 crate versions
// in the dependency graph is safe.
use spl_token_2022::extension::scaled_ui_amount::ScaledUiAmountConfig;
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use spl_token_2022::state::Mint as Token2022Mint;

use crate::errors::LendingError;

/// Fixed-point scale the f64 multiplier is converted into. 1e9 gives
/// nanosecond-grade precision on typical multipliers (close to 1.0), far
/// beyond what a share-count conversion needs.
pub const MULTIPLIER_SCALE: u128 = 1_000_000_000;

/// Reads the mint's current scaled-ui-amount multiplier (accounting for a
/// pending scheduled multiplier change, per the extension's own effective
/// timestamp semantics) and returns it as a `MULTIPLIER_SCALE`-fixed-point
/// integer. Returns `MULTIPLIER_SCALE` (i.e. 1.0) if the mint has no such
/// extension, so this helper is safe to call on a plain SPL mint too.
pub fn read_multiplier_fp(mint_account_info: &AccountInfo, now_ts: i64) -> Result<u128> {
    let data = mint_account_info.try_borrow_data()?;
    let mint_with_extensions = StateWithExtensions::<Token2022Mint>::unpack(&data)
        .map_err(|_| error!(LendingError::InvalidScaledUiExtension))?;

    let config = match mint_with_extensions.get_extension::<ScaledUiAmountConfig>() {
        Ok(cfg) => cfg,
        Err(_) => return Ok(MULTIPLIER_SCALE), // no extension present: multiplier is 1.0
    };

    let effective_ts: i64 = config.new_multiplier_effective_timestamp.into();
    let active_multiplier: f64 = if now_ts >= effective_ts {
        config.new_multiplier.into()
    } else {
        config.multiplier.into()
    };

    require!(active_multiplier.is_finite() && active_multiplier > 0.0, LendingError::InvalidScaledUiExtension);

    let fixed = (active_multiplier * MULTIPLIER_SCALE as f64).round();
    require!(fixed.is_finite() && fixed > 0.0, LendingError::InvalidScaledUiExtension);
    Ok(fixed as u128)
}

/// Converts a base-unit token amount into its display ("UI") amount, in
/// the same base-unit integer domain (i.e. still scaled by the mint's
/// decimals -- this only applies the scaled-ui-amount multiplier, it does
/// not touch decimal places).
pub fn base_to_ui_amount(base_amount: u64, multiplier_fp: u128) -> Result<u64> {
    let scaled = (base_amount as u128)
        .checked_mul(multiplier_fp)
        .and_then(|v| v.checked_div(MULTIPLIER_SCALE))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok(scaled as u64)
}

/// Inverse of `base_to_ui_amount`: converts a display ("UI") amount back
/// into the raw base-unit amount a token account/vault actually holds.
pub fn ui_to_base_amount(ui_amount: u64, multiplier_fp: u128) -> Result<u64> {
    let base = (ui_amount as u128)
        .checked_mul(MULTIPLIER_SCALE)
        .and_then(|v| v.checked_div(multiplier_fp))
        .ok_or_else(|| error!(LendingError::InvalidScaledUiExtension))?;
    Ok(base as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_to_ui_amount_identity_multiplier() {
        assert_eq!(base_to_ui_amount(1_000_000, MULTIPLIER_SCALE).unwrap(), 1_000_000);
    }

    #[test]
    fn base_to_ui_amount_applies_multiplier() {
        // multiplier 2.5x
        let mult = MULTIPLIER_SCALE * 5 / 2;
        assert_eq!(base_to_ui_amount(1_000_000, mult).unwrap(), 2_500_000);
    }

    #[test]
    fn base_to_ui_amount_applies_fractional_multiplier() {
        // multiplier 0.5x (e.g. a 2-for-1 style forward split represented downward)
        let mult = MULTIPLIER_SCALE / 2;
        assert_eq!(base_to_ui_amount(1_000_000, mult).unwrap(), 500_000);
    }

    #[test]
    fn ui_to_base_amount_is_inverse_of_base_to_ui_amount() {
        let mult = MULTIPLIER_SCALE * 5 / 2;
        let base = 4_000_000u64;
        let ui = base_to_ui_amount(base, mult).unwrap();
        assert_eq!(ui_to_base_amount(ui, mult).unwrap(), base);
    }
}
