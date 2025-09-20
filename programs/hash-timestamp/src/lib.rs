use anchor_lang::prelude::*;

declare_id!("HTSx1VNWNBDGtfwr2nU8gSzhxfFtUxd2nkdFq7SCSZzY");

pub mod instructions;
pub mod state;

use instructions::*;

#[program]
pub mod hash_timestamp {
    use super::*;

    // Vote for a hash; create the hash account if missing;
    // deposit exactly the rent-exempt minimum for this account size.
    pub fn vote(ctx: Context<Vote>, hash: [u8; 32]) -> Result<()> {
        handlers::vote(ctx, hash)
    }

    // Remove caller's vote and withdraw their deposit; auto-close if zero voters remain.
    pub fn unvote(ctx: Context<Unvote>, hash: [u8; 32]) -> Result<()> {
        handlers::unvote(ctx, hash)
    }

    // Verify that the hash account exists (no-op if OK).
    pub fn verify(ctx: Context<Verify>, hash: [u8; 32]) -> Result<()> {
        handlers::verify(ctx, hash)
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
}
