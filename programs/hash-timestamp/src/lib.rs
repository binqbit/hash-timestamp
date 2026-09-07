//! Hash Timestamp program entrypoints.
//!
//! Each `instructions` handler owns its scenario and account context.
//! `protocol` owns deterministic hashes/addresses; `runtime` owns account
//! validation and mutation; `state` owns persisted data.

use anchor_lang::prelude::*;

declare_id!("HTSx1wheA1TnHSEbKWxmtXKgJNyRfF3QxeK2hHQcJ9pN");

mod telemetry;

pub mod error;
pub mod instructions;
mod protocol;
mod runtime;
pub mod state;

pub use error::ErrorCode;

#[cfg(test)]
mod compatibility_tests;

use instructions::handlers;
use instructions::*;

#[program]
pub mod hash_timestamp {
    use super::*;

    /// Register a new hash account with the given hash payload.
    pub fn register(ctx: Context<Register>, hash: [u8; 32]) -> Result<()> {
        handlers::register(ctx, hash)
    }

    /// Produce a hash account from an arbitrary account's metadata.
    pub fn account(ctx: Context<AccountHash>) -> Result<()> {
        handlers::account_hash(ctx)
    }

    /// Derive a new hash from an existing one and optionally migrate the caller's vote.
    pub fn branch(ctx: Context<Branch>, payload: [u8; 32], take_vote: bool) -> Result<()> {
        handlers::branch(ctx, payload, take_vote)
    }

    /// Create a batch hash that aggregates several existing hashes.
    pub fn batch<'info>(ctx: Context<'_, '_, '_, 'info, Batch<'info>>) -> Result<()> {
        handlers::batch(ctx)
    }

    /// Pack existing hash accounts into a minimal composite hash.
    pub fn pack<'info>(ctx: Context<'_, '_, '_, 'info, Pack<'info>>) -> Result<()> {
        handlers::pack(ctx)
    }

    /// Restore previously existing hashes by proving ancestry from a known chain tip.
    pub fn restore<'info>(
        ctx: Context<'_, '_, '_, 'info, Restore<'info>>,
        proof_chain: Vec<RestoreProofLink>,
    ) -> Result<()> {
        handlers::restore(ctx, proof_chain)
    }

    /// Vote for a hash and deposit exactly the rent-exempt minimum for this account size.
    pub fn vote(ctx: Context<Vote>) -> Result<()> {
        handlers::vote(ctx)
    }

    /// Remove caller's vote and withdraw their deposit; auto-close if zero voters remain.
    pub fn unvote(ctx: Context<Unvote>) -> Result<()> {
        handlers::unvote(ctx)
    }

    /// Verify the integrity and authenticity of a hash account.
    pub fn verify(ctx: Context<Verify>) -> Result<()> {
        handlers::verify(ctx)
    }
}
