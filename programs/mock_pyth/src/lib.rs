//! Test-only Pyth `PriceUpdateV2` writer.
//!
//! Not a Vigil product component -- this exists purely so local tests (and
//! the devnet demo, which has no live Hermes keeper wired up yet) can
//! produce an account regime_oracle will accept as a Pyth price update,
//! deterministically and without depending on real Hermes data. Whichever
//! program's ID is configured as a `RegimeState.pyth_receiver_program` is
//! the one regime_oracle trusts -- production configurations must point
//! that at Pyth's real Solana Receiver program instead of this one.
//!
//! The account layout here is byte-identical to `regime_oracle`'s
//! `pyth_types::PriceUpdateV2` mirror (same field order/types), which is
//! what makes accounts written by this program readable by regime_oracle's
//! manual deserialization -- Anchor's account discriminator is derived
//! from the struct name alone, so as long as both crates name it
//! `PriceUpdateV2` and lay out fields identically, the bytes match.

use anchor_lang::prelude::*;

declare_id!("BA6ND81qDqr1spCJsdkQk92Q7wzanvLYBRijSiY9h7Xw");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[account]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32])]
pub struct SetPrice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 2 + (32 + 8 + 8 + 4 + 8 + 8 + 8 + 8) + 8,
        seeds = [b"mock_price", feed_id.as_ref()],
        bump,
    )]
    pub price_update: Account<'info, PriceUpdateV2>,

    pub system_program: Program<'info, System>,
}

#[program]
pub mod mock_pyth {
    use super::*;

    pub fn set_price(
        ctx: Context<SetPrice>,
        feed_id: [u8; 32],
        price: i64,
        conf: u64,
        exponent: i32,
        publish_time: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let account = &mut ctx.accounts.price_update;
        account.write_authority = ctx.accounts.payer.key();
        account.verification_level = VerificationLevel::Full;
        account.price_message = PriceFeedMessage {
            feed_id,
            price,
            conf,
            exponent,
            publish_time,
            prev_publish_time: publish_time,
            ema_price: price,
            ema_conf: conf,
        };
        account.posted_slot = clock.slot;
        Ok(())
    }
}
