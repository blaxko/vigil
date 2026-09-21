//! A local mirror of the Pyth Receiver program's `PriceUpdateV2` account.
//!
//! We deliberately do NOT depend on the `pyth-solana-receiver-sdk` crate:
//! at the time this was written it pulls in an `anchor-lang` major version
//! that conflicts with the one this workspace pins, which makes its
//! `PriceUpdateV2` fail to satisfy `anchor_lang::Account<'info, T>`'s
//! trait bounds from *our* `anchor-lang` (two different crate instances of
//! the same trait). Instead we define an account struct with the exact
//! same name, field order, and types as the real on-chain account.
//! Anchor's 8-byte account discriminator is `sha256("account:<StructName>")[..8]`
//! -- driven entirely by the struct name and Anchor's own derive, not by
//! which crate defines it -- so this struct deserializes real
//! `PriceUpdateV2` accounts written by Pyth's Receiver program correctly,
//! with zero extra dependencies and zero version-skew risk.
//!
//! Layout source: Pyth Network's `pyth-solana-receiver-sdk`
//! `price_update.rs` (`PriceUpdateV2` / `PriceFeedMessage` /
//! `VerificationLevel`), which is a stable, documented on-chain format.

use anchor_lang::prelude::*;

use crate::errors::RegimeError;

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

/// Minimal decoded price, mirroring what the real SDK's
/// `get_price_no_older_than` returns.
pub struct Price {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

impl PriceUpdateV2 {
    /// Staleness-bounded, feed-id-checked, fully-verified price read. Never read
    /// `price_message` fields directly elsewhere in the program -- always
    /// go through this so the staleness bound and feed id are enforced at
    /// a single point.
    pub fn get_price_no_older_than(
        &self,
        clock: &Clock,
        maximum_age_secs: u64,
        feed_id: &[u8; 32],
    ) -> Result<Price> {
        require!(&self.price_message.feed_id == feed_id, RegimeError::WrongPriceFeed);
        // A partially-verified update carries fewer Wormhole guardian signatures than the
        // quorum, so its price has not been attested. Only Full is accepted, matching
        // Pyth's own default for price reads.
        require!(self.verification_level == VerificationLevel::Full, RegimeError::PriceNotFullyVerified);

        let age = clock
            .unix_timestamp
            .checked_sub(self.price_message.publish_time)
            .ok_or(RegimeError::StalePythPrice)?;
        require!(age >= 0, RegimeError::StalePythPrice);
        require!((age as u64) <= maximum_age_secs, RegimeError::StalePythPrice);

        Ok(Price {
            price: self.price_message.price,
            conf: self.price_message.conf,
            exponent: self.price_message.exponent,
            publish_time: self.price_message.publish_time,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(publish_time: i64, feed_id: [u8; 32]) -> PriceUpdateV2 {
        PriceUpdateV2 {
            write_authority: Pubkey::default(),
            verification_level: VerificationLevel::Full,
            price_message: PriceFeedMessage {
                feed_id,
                price: 150_000_000,
                conf: 100_000,
                exponent: -8,
                publish_time,
                prev_publish_time: publish_time - 1,
                ema_price: 150_000_000,
                ema_conf: 100_000,
            },
            posted_slot: 1,
        }
    }

    fn clock_at(ts: i64) -> Clock {
        Clock {
            slot: 0,
            epoch_start_timestamp: 0,
            epoch: 0,
            leader_schedule_epoch: 0,
            unix_timestamp: ts,
        }
    }

    #[test]
    fn accepts_fresh_price_within_bound() {
        let feed = [7u8; 32];
        let update = sample(1_000, feed);
        let clock = clock_at(1_030);
        let price = update.get_price_no_older_than(&clock, 60, &feed).unwrap();
        assert_eq!(price.price, 150_000_000);
    }

    #[test]
    fn rejects_price_older_than_bound() {
        let feed = [7u8; 32];
        let update = sample(1_000, feed);
        let clock = clock_at(1_100); // 100s old, bound is 60s
        assert!(update.get_price_no_older_than(&clock, 60, &feed).is_err());
    }

    #[test]
    fn rejects_mismatched_feed_id() {
        let feed = [7u8; 32];
        let other_feed = [9u8; 32];
        let update = sample(1_000, feed);
        let clock = clock_at(1_010);
        assert!(update.get_price_no_older_than(&clock, 60, &other_feed).is_err());
    }

    #[test]
    fn rejects_partially_verified_update() {
        let feed = [7u8; 32];
        let mut update = sample(1_000, feed);
        update.verification_level = VerificationLevel::Partial { num_signatures: 3 };
        let clock = clock_at(1_010);
        assert!(update.get_price_no_older_than(&clock, 60, &feed).is_err());
    }

    #[test]
    fn accepts_fully_verified_update() {
        let feed = [7u8; 32];
        let mut update = sample(1_000, feed);
        update.verification_level = VerificationLevel::Full;
        let clock = clock_at(1_010);
        assert!(update.get_price_no_older_than(&clock, 60, &feed).is_ok());
    }

    #[test]
    fn rejects_future_publish_time() {
        let feed = [7u8; 32];
        let update = sample(2_000, feed);
        let clock = clock_at(1_000); // publish_time is "in the future" relative to clock
        assert!(update.get_price_no_older_than(&clock, 60, &feed).is_err());
    }
}
