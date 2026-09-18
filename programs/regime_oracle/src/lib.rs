use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod math;
pub mod pyth_types;
pub mod state;

use instructions::*;

declare_id!("7PHoqxS9CQxy6vTmDCEqkmB1oNCeCotxFSPg3rKmDQUV");

#[program]
pub mod regime_oracle {
    use super::*;

    /// One-time setup of a `RegimeState` PDA for a given Pyth price feed id
    /// (one per collateral asset, matching the isolated-market design).
    pub fn initialize(
        ctx: Context<Initialize>,
        price_feed_id: [u8; 32],
        initial_price: u64,
        pyth_receiver_program: Pubkey,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, price_feed_id, initial_price, pyth_receiver_program)
    }

    /// Keeper-only: flips the market open/closed flag.
    pub fn set_regime(ctx: Context<SetRegime>, is_open: bool) -> Result<()> {
        instructions::set_regime::handler(ctx, is_open)
    }

    /// Keeper-only: records the latest off-chain-computed DEX TWAP and the
    /// liquidity depth it was computed over.
    pub fn post_dex_reference(
        ctx: Context<PostDexReference>,
        dex_price: u64,
        dex_liquidity: u128,
    ) -> Result<()> {
        instructions::post_dex_reference::handler(ctx, dex_price, dex_liquidity)
    }

    /// Permissionless crank: recomputes Borrow-Limit Price and Liquidation
    /// Price via the anchor-decay-clamp blend.
    pub fn update_price(ctx: Context<UpdatePrice>) -> Result<()> {
        instructions::update_price::handler(ctx)
    }
}
