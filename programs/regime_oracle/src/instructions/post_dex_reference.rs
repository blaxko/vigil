use anchor_lang::prelude::*;

use crate::errors::RegimeError;
use crate::state::RegimeState;

#[derive(Accounts)]
pub struct PostDexReference<'info> {
    /// Must match `regime_state.keeper_authority`. Permissioned: the DEX
    /// reference is only as trustworthy as whoever is allowed to post it.
    pub keeper_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [RegimeState::SEED_PREFIX, regime_state.price_feed_id.as_ref()],
        bump = regime_state.bump,
        has_one = keeper_authority @ RegimeError::UnauthorizedKeeper,
    )]
    pub regime_state: Account<'info, RegimeState>,
}

/// Records the keeper's off-chain-computed DEX TWAP and the liquidity depth
/// it was computed over (documented MVP simplification: full on-chain CLMM
/// TWAP computation is out of scope, see brief section 6). Liquidity is
/// what lets `update_price` dampen a thin pool's influence on the blend.
pub fn handler(ctx: Context<PostDexReference>, dex_price: u64, dex_liquidity: u128) -> Result<()> {
    require!(dex_price > 0 && dex_liquidity > 0, RegimeError::InvalidDexReference);

    let clock = Clock::get()?;
    let state = &mut ctx.accounts.regime_state;
    state.dex_reference_price = dex_price;
    state.dex_reference_liquidity = dex_liquidity;
    state.dex_reference_ts = clock.unix_timestamp;
    Ok(())
}
