use anchor_lang::prelude::*;

use crate::errors::LendingError;

/// Maximum age (seconds) `regime_oracle::RegimeState.last_update_ts` may
/// have and still be trusted by a price-dependent lending instruction.
/// Independent of, and in addition to, the Pyth-level staleness bound
/// enforced inside `regime_oracle::update_price` itself -- this guards
/// against the *keeper crank* going stale, not just the underlying feed.
pub const MAX_ORACLE_AGE_SECS: i64 = 180;

pub fn assert_oracle_fresh(last_update_ts: i64, now_ts: i64) -> Result<()> {
    require!(
        now_ts.saturating_sub(last_update_ts) <= MAX_ORACLE_AGE_SECS,
        LendingError::StaleOraclePrices
    );
    Ok(())
}
