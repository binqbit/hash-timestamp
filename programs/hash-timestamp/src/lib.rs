use anchor_lang::prelude::*;

declare_id!("HTSx1wheA1TnHSEbKWxmtXKgJNyRfF3QxeK2hHQcJ9pN");

pub mod instructions;
pub mod logic;
pub mod state;
pub mod utils;

use instructions::handlers;
use instructions::*;

#[program]
pub mod hash_timestamp {
    use super::*;

    // Register a new hash account (genesis or standalone hash).
    pub fn register(ctx: Context<Register>, hash: [u8; 32]) -> Result<()> {
        handlers::register(ctx, hash)
    }

    // Produce a hash account from an arbitrary account's metadata.
    pub fn account(ctx: Context<AccountHash>) -> Result<()> {
        handlers::account_hash(ctx)
    }

    // Pack existing hash accounts into a minimal composite hash.
    pub fn pack(ctx: Context<Pack>) -> Result<()> {
        handlers::pack(ctx)
    }

    // Derive a new hash from an existing one and optionally migrate the caller's vote.
    pub fn branch(ctx: Context<Branch>, payload: [u8; 32], take_vote: bool) -> Result<()> {
        handlers::branch(ctx, payload, take_vote)
    }

    // Create a batch hash that aggregates several existing hashes.
    pub fn batch(ctx: Context<Batch>) -> Result<()> {
        handlers::batch(ctx)
    }

    // Vote for a hash; create the hash account if missing;
    // deposit exactly the rent-exempt minimum for this account size.
    pub fn vote(ctx: Context<Vote>) -> Result<()> {
        handlers::vote(ctx)
    }

    // Remove caller's vote and withdraw their deposit; auto-close if zero voters remain.
    pub fn unvote(ctx: Context<Unvote>) -> Result<()> {
        handlers::unvote(ctx)
    }

    // Verify that the hash account exists (no-op if OK).
    pub fn verify(ctx: Context<Verify>) -> Result<()> {
        handlers::verify(ctx)
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Hash not found")]
    HashNotFound,
    #[msg("Invalid hash PDA seeds")]
    InvalidHashSeeds,
    #[msg("Already voted for this hash")]
    AlreadyVoted,
    #[msg("Caller is not the voter")]
    NotVoter,
    #[msg("Votes are not zero")]
    VotesNotZero,
    #[msg("Derived hash mismatch")]
    DerivedHashMismatch,
    #[msg("Expected vote account for migration")]
    VoteAccountMissing,
    #[msg("Vote migration requested but no vote exists")]
    NoVoteToMigrate,
    #[msg("Hash generation overflowed")]
    GenerationOverflow,
    #[msg("Hash already exists")]
    HashAlreadyExists,
    #[msg("Batch requires at least one member")]
    BatchMembersEmpty,
    #[msg("Batch member account not owned by the program")]
    BatchMemberWrongProgram,
    #[msg("Pack requires at least one member")]
    PackMembersEmpty,
    #[msg("Pack member account not owned by the program")]
    PackMemberWrongProgram,
}
