use anchor_lang::prelude::*;

#[error_code]
pub enum LendingError {
    #[msg("Regime oracle prices are stale relative to this instruction")]
    StaleOraclePrices,
    #[msg("Requested borrow amount exceeds the Borrow-Limit-Price-derived limit")]
    BorrowLimitExceeded,
    #[msg("Withdrawal would leave the position under-collateralized")]
    WithdrawalExceedsLimit,
    #[msg("Repay amount exceeds outstanding debt")]
    RepayExceedsDebt,
    #[msg("Withdrawal amount exceeds deposited collateral")]
    InsufficientCollateral,
    #[msg("Position is still within its minimum hold time")]
    PositionHoldTimeActive,
    #[msg("Position is not eligible for liquidation: health factor is healthy")]
    PositionNotLiquidatable,
    #[msg("Provided regime_state account does not match this reserve's configured oracle")]
    OracleMismatch,
    #[msg("Provided mint does not match this reserve's configured mint")]
    MintMismatch,
    #[msg("Token-2022 scaled-UI-amount extension data was malformed or missing a multiplier")]
    InvalidScaledUiExtension,
}
