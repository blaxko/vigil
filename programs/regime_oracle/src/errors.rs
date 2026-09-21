use anchor_lang::prelude::*;

#[error_code]
pub enum RegimeError {
    #[msg("Pyth price update is stale beyond the allowed threshold")]
    StalePythPrice,
    #[msg("Pyth price feed id does not match the configured AAPLx feed")]
    WrongPriceFeed,
    #[msg("Pyth price or confidence is not positive")]
    InvalidPythPrice,
    #[msg("DEX reference price or liquidity is not positive")]
    InvalidDexReference,
    #[msg("Only the configured keeper authority may call this instruction")]
    UnauthorizedKeeper,
    #[msg("Regime is already set to the requested value")]
    RegimeUnchanged,
    #[msg("DEX reference has not been posted yet")]
    MissingDexReference,

    // -- math.rs (kept here because Anchor's IDL builder only allows one
    // #[error_code] enum per program crate) --
    #[msg("Checked arithmetic overflow or underflow in oracle math")]
    Overflow,
    #[msg("Price input must be greater than zero")]
    NonPositivePrice,

    // Appended last so existing error codes do not shift.
    #[msg("Pyth price update is not fully verified")]
    PriceNotFullyVerified,
}
