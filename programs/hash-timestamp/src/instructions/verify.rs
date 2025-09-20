use anchor_lang::prelude::*;

use crate::state::HashAccount;
use crate::ErrorCode;

#[derive(Accounts)]
#[instruction(hash: [u8; 32])]
pub struct Verify<'info> {
    #[account(
        seeds = [b"hash", hash.as_ref()],
        bump = hash_account.bump,
        constraint = hash_account.hash == hash @ ErrorCode::InvalidHashSeeds,
    )]
    pub hash_account: Account<'info, HashAccount>,
}

pub fn verify(_ctx: Context<Verify>, _hash: [u8; 32]) -> Result<()> {
    Ok(())
}
